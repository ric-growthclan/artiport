import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gitBlobOid } from './git';
import type { CommitResult, DataStore, StoredFile } from './store';

const HEAD_FILE = '.artiport-head';

/** Data files in a local directory with the same head checks as GitHub. For development and tests. */
export class FsStore implements DataStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async list(prefixes: string[]): Promise<{ head: string | null; files: Record<string, string> }> {
    const head = await this.head();
    const files: Record<string, string> = {};
    for (const path of await walk(this.root)) {
      if (!prefixes.some((prefix) => path.startsWith(prefix))) continue;
      files[path] = await gitBlobOid(await readFile(this.resolvePath(path), 'utf8'));
    }
    return { head, files };
  }

  async read(paths: string[]): Promise<{ head: string | null; files: Record<string, StoredFile | null> }> {
    const head = await this.head();
    const files: Record<string, StoredFile | null> = {};
    for (const path of paths) {
      try {
        const text = await readFile(this.resolvePath(path), 'utf8');
        files[path] = { oid: await gitBlobOid(text), text };
      } catch {
        files[path] = null;
      }
    }
    return { head, files };
  }

  commit(expectedHead: string | null, files: Record<string, string>, message: string): Promise<CommitResult> {
    const run = this.queue.then(async (): Promise<CommitResult> => {
      const head = await this.head();
      if (head !== expectedHead) return { ok: false };
      for (const [path, text] of Object.entries(files)) {
        const target = this.resolvePath(path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, text);
      }
      const next = createHash('sha1')
        .update(`${head}\n${message}\n${JSON.stringify(files)}\n${Date.now()}`)
        .digest('hex');
      await writeFile(join(this.root, HEAD_FILE), next);
      return { ok: true, head: next };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async head(): Promise<string> {
    try {
      return (await readFile(join(this.root, HEAD_FILE), 'utf8')).trim();
    } catch {
      const head = randomBytes(20).toString('hex');
      await mkdir(this.root, { recursive: true });
      await writeFile(join(this.root, HEAD_FILE), head);
      return head;
    }
  }

  private resolvePath(path: string): string {
    const target = resolve(this.root, path);
    if (!target.startsWith(this.root + sep)) throw new Error(`Path escapes the data directory: ${path}`);
    return target;
  }
}

async function walk(root: string, dir = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(root, full)));
    else paths.push(relative(root, full).split(sep).join('/'));
  }
  return paths;
}
