import { utf8ToBase64 } from './git';
import type { CommitResult, DataStore, StoredFile } from './store';

export interface GitHubStoreOptions {
  /** "owner/name" of the private data repository. */
  repo: string;
  branch: string;
  token: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

interface GraphQLError {
  message: string;
  type?: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
}

interface TreeNode {
  name: string;
  type: string;
  oid: string;
  object?: { entries?: TreeNode[] } | null;
}

interface FileNode {
  oid: string;
  object?: { text?: string | null; isTruncated?: boolean } | null;
}

const READ_BATCH = 40;

// Four levels cover sections/<slug>/kv.json and sections/<slug>/db/<collection>.json.
const TREE_QUERY = `query($owner:String!,$name:String!,$rev:String!){repository(owner:$owner,name:$name){object(expression:$rev){... on Commit{oid tree{entries{...L1}}}}}}
fragment L1 on TreeEntry{name type oid object{... on Tree{entries{...L2}}}}
fragment L2 on TreeEntry{name type oid object{... on Tree{entries{...L3}}}}
fragment L3 on TreeEntry{name type oid object{... on Tree{entries{name type oid}}}}`;

const COMMIT_MUTATION = `mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}`;

/** Data files in a GitHub repository: GraphQL reads pinned to one commit, one atomic commit per write. */
export class GitHubStore implements DataStore {
  /** GitHub's token expiration header from the last response, when the token expires. */
  tokenExpiration: string | null = null;
  private readonly owner: string;
  private readonly name: string;
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubStoreOptions) {
    const [owner, name, extra] = options.repo.split('/');
    if (!owner || !name || extra !== undefined) {
      throw new Error(`The data repo must look like "owner/name", got "${options.repo}"`);
    }
    this.owner = owner;
    this.name = name;
    this.api = (options.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async list(prefixes: string[]): Promise<{ head: string | null; files: Record<string, string> }> {
    const result = await this.graphql<{
      repository: { object: { oid: string; tree: { entries: TreeNode[] } } | null } | null;
    }>(TREE_QUERY, { owner: this.owner, name: this.name, rev: this.options.branch });
    throwErrors(result);
    const commit = result.data?.repository?.object;
    if (!commit) return { head: null, files: {} };
    const files: Record<string, string> = {};
    const visit = (nodes: TreeNode[], base: string) => {
      for (const node of nodes) {
        const path = base + node.name;
        if (node.type === 'blob') {
          if (prefixes.some((prefix) => path.startsWith(prefix))) files[path] = node.oid;
        } else if (node.type === 'tree' && node.object?.entries) {
          visit(node.object.entries, `${path}/`);
        }
      }
    };
    visit(commit.tree.entries, '');
    return { head: commit.oid, files };
  }

  async read(paths: string[]): Promise<{ head: string | null; files: Record<string, StoredFile | null> }> {
    if (paths.length === 0) return { head: (await this.list([])).head, files: {} };
    let head: string | null = null;
    const files: Record<string, StoredFile | null> = {};
    for (let start = 0; start < paths.length; start += READ_BATCH) {
      const batch = paths.slice(start, start + READ_BATCH);
      const declarations = batch.map((_, i) => `,$p${i}:String!`).join('');
      const fields = batch.map((_, i) => `f${i}:file(path:$p${i}){oid object{... on Blob{text isTruncated}}}`).join(' ');
      const query = `query($owner:String!,$name:String!,$rev:String!${declarations}){repository(owner:$owner,name:$name){object(expression:$rev){... on Commit{oid ${fields}}}}}`;
      // Later batches pin the commit the first batch saw, so all files come from one snapshot.
      const variables: Record<string, unknown> = { owner: this.owner, name: this.name, rev: head ?? this.options.branch };
      batch.forEach((path, i) => {
        variables[`p${i}`] = path;
      });
      const result = await this.graphql<{
        repository: { object: ({ oid: string } & Record<string, FileNode | null | string>) | null } | null;
      }>(query, variables);
      throwErrors(result);
      const commit = result.data?.repository?.object;
      if (!commit) {
        for (const path of batch) files[path] = null;
        continue;
      }
      head = commit.oid;
      for (const [i, path] of batch.entries()) {
        const node = commit[`f${i}`] as FileNode | null;
        if (!node) {
          files[path] = null;
          continue;
        }
        const blob = node.object;
        const text = blob?.text != null && !blob.isTruncated ? blob.text : await this.readRaw(path, commit.oid);
        files[path] = { oid: node.oid, text };
      }
    }
    return { head, files };
  }

  async commit(expectedHead: string | null, files: Record<string, string>, message: string): Promise<CommitResult> {
    if (!expectedHead) {
      throw new Error('The data repository has no commits yet: create it with an initial commit (gh repo create --private --add-readme).');
    }
    const input = {
      branch: { repositoryNameWithOwner: `${this.owner}/${this.name}`, branchName: this.options.branch },
      expectedHeadOid: expectedHead,
      message: { headline: message },
      fileChanges: {
        additions: Object.entries(files).map(([path, text]) => ({ path, contents: utf8ToBase64(text) })),
      },
    };
    const result = await this.graphql<{ createCommitOnBranch: { commit: { oid: string } } | null }>(COMMIT_MUTATION, {
      input,
    });
    if (result.errors?.some(isStaleHead)) return { ok: false };
    throwErrors(result);
    const oid = result.data?.createCommitOnBranch?.commit.oid;
    if (!oid) throw new Error('GitHub accepted the commit but returned no id');
    return { ok: true, head: oid };
  }

  private async readRaw(path: string, ref: string): Promise<string> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.api}/repos/${this.owner}/${this.name}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
    const response = await this.fetchImpl(url, { headers: this.headers('application/vnd.github.raw+json') });
    this.noteExpiration(response);
    if (!response.ok) throw new Error(`Reading ${path} from GitHub failed: HTTP ${response.status}`);
    return response.text();
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const response = await this.fetchImpl(`${this.api}/graphql`, {
      method: 'POST',
      headers: { ...this.headers('application/json'), 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    this.noteExpiration(response);
    if (response.status === 401) {
      throw new Error('GitHub rejected the token: it is expired, revoked or lacks Contents access to the data repo');
    }
    if (!response.ok) throw new Error(`GitHub GraphQL request failed: HTTP ${response.status}`);
    return (await response.json()) as GraphQLResponse<T>;
  }

  private headers(accept: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.token}`,
      accept,
      'user-agent': 'artiport',
      'x-github-api-version': '2022-11-28',
    };
  }

  private noteExpiration(response: Response): void {
    this.tokenExpiration = response.headers.get('github-authentication-token-expiration') ?? this.tokenExpiration;
  }
}

function throwErrors(result: GraphQLResponse<unknown>): void {
  if (result.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${result.errors.map((error) => error.message).join('; ')}`);
  }
}

function isStaleHead(error: GraphQLError): boolean {
  return error.type === 'STALE_DATA' || /expected branch to point to/i.test(error.message);
}
