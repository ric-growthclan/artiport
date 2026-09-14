import { isEntry, parseDataFile, serializeDataFile } from '../shared/codec';
import { mergeIncoming } from '../shared/merge';
import { isSyncPath, slugFromPath } from '../shared/paths';
import type { Changes, Entry, FilePayload, PullRequest, SyncRequest } from '../shared/types';
import { checkPassphrase, clearSessionCookie, createSessionCookie, hasValidSession, type AuthConfig } from './auth';
import { gitBlobOid } from './git';
import { assertSameOriginJson, errorResponse, HttpError, json, readJson } from './http';
import type { DataStore } from './store';

export interface HandlerDeps {
  store: () => DataStore;
  auth: () => AuthConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_PATHS = 50;
const MAX_KEYS_PER_PATH = 5000;
const MAX_KEY_LENGTH = 512;
const MAX_FILE_BYTES = 900_000;
const COMMIT_ATTEMPTS = 3;
const FAILED_LOGIN_DELAY_MS = 1000;

export async function handleSync(request: Request, deps: HandlerDeps): Promise<Response> {
  try {
    await requireSession(request, deps.auth());
    assertSameOriginJson(request);
    const changes = validateChanges(await readJson<unknown>(request));
    const paths = Object.keys(changes);
    const store = deps.store();
    const now = deps.now ?? Date.now;

    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
      const current = await store.read(paths);
      const at = now();
      const writes: Record<string, string> = {};
      const files: Record<string, FilePayload> = {};
      for (const path of paths) {
        const stored = current.files[path];
        const merged = mergeIncoming(parseDataFile(stored?.text), changes[path], at);
        if (merged.changed || !stored) {
          const text = serializeDataFile(merged.file);
          if (text.length > MAX_FILE_BYTES) throw new HttpError(413, 'file_too_large', `${path} would exceed the size limit`);
          writes[path] = text;
          files[path] = { oid: await gitBlobOid(text), data: merged.file };
        } else {
          files[path] = { oid: stored.oid, data: merged.file };
        }
      }
      if (Object.keys(writes).length === 0) return json({ head: current.head, now: at, files });
      const result = await store.commit(current.head, writes, commitMessage(Object.keys(writes)));
      if (result.ok) return json({ head: result.head, now: at, files });
    }
    throw new HttpError(409, 'conflict', 'Data changed on the server during sync, retry');
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePull(request: Request, deps: HandlerDeps): Promise<Response> {
  try {
    await requireSession(request, deps.auth());
    assertSameOriginJson(request);
    const body = (await readJson<Partial<PullRequest> | null>(request)) ?? {};
    const known: Record<string, string> = typeof body.known === 'object' && body.known !== null ? body.known : {};
    const store = deps.store();
    const listing = await store.list(['sections/']);
    const at = (deps.now ?? Date.now)();
    if (body.head && body.head === listing.head) {
      return json({ unchanged: true, head: listing.head, now: at });
    }

    const remote = Object.entries(listing.files).filter(([path]) => isSyncPath(path));
    const remotePaths = new Set(remote.map(([path]) => path));
    const wanted = remote.filter(([path, oid]) => known[path] !== oid).map(([path]) => path);
    const removed = Object.keys(known).filter((path) => isSyncPath(path) && !remotePaths.has(path));
    const files: Record<string, FilePayload> = {};
    if (wanted.length > 0) {
      const read = await store.read(wanted);
      for (const path of wanted) {
        const stored = read.files[path];
        if (!stored) continue;
        try {
          files[path] = { oid: stored.oid, data: parseDataFile(stored.text) };
        } catch (error) {
          console.error(`[artiport] skipping unreadable ${path}`, error);
        }
      }
    }
    // Report the listed head, not a newer one the read may have seen: the next pull then diffs again.
    return json({ unchanged: false, head: listing.head, now: at, files, removed });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogin(request: Request, deps: HandlerDeps): Promise<Response> {
  try {
    assertSameOriginJson(request);
    const auth = deps.auth();
    const body = await readJson<{ passphrase?: unknown } | null>(request, 10_000);
    const passphrase = typeof body?.passphrase === 'string' ? body.passphrase.trim() : '';
    if (!passphrase || !(await checkPassphrase(passphrase, auth))) {
      await (deps.sleep ?? sleep)(FAILED_LOGIN_DELAY_MS);
      throw new HttpError(401, 'invalid_passphrase');
    }
    return json({ ok: true }, { headers: { 'set-cookie': await createSessionCookie(auth, request.url) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogout(request: Request): Promise<Response> {
  try {
    assertSameOriginJson(request);
    return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie(request.url) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSession(request: Request, deps: HandlerDeps): Promise<Response> {
  try {
    const authenticated = await hasValidSession(request, deps.auth());
    return json({ authenticated }, { status: authenticated ? 200 : 401 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireSession(request: Request, auth: AuthConfig): Promise<void> {
  if (!(await hasValidSession(request, auth))) throw new HttpError(401, 'unauthorized');
}

function validateChanges(body: unknown): Changes {
  const changes = (body as Partial<SyncRequest> | null)?.changes;
  if (typeof changes !== 'object' || changes === null) throw new HttpError(400, 'bad_request', 'Missing changes');
  const paths = Object.keys(changes);
  if (paths.length > MAX_PATHS) throw new HttpError(413, 'too_many_files');
  const clean: Changes = {};
  for (const path of paths) {
    if (!isSyncPath(path)) throw new HttpError(400, 'bad_path', `Path not allowed: ${path}`);
    const entries: unknown = changes[path];
    if (typeof entries !== 'object' || entries === null) throw new HttpError(400, 'bad_request', `Bad entries for ${path}`);
    const keys = Object.keys(entries);
    if (keys.length === 0) continue;
    if (keys.length > MAX_KEYS_PER_PATH) throw new HttpError(413, 'too_many_keys');
    for (const key of keys) {
      if (key.length > MAX_KEY_LENGTH) throw new HttpError(400, 'key_too_long');
      if (!isEntry((entries as Record<string, unknown>)[key])) {
        throw new HttpError(400, 'bad_entry', `Bad entry ${path} → ${key}`);
      }
    }
    clean[path] = entries as Record<string, Entry>;
  }
  return clean;
}

function commitMessage(paths: string[]): string {
  const slugs = [...new Set(paths.map((path) => slugFromPath(path) ?? path))];
  return slugs.length === 1 ? `sync(${slugs[0]})` : `sync: ${slugs.join(', ')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
