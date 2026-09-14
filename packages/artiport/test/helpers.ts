import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionCookie, type AuthConfig } from '../src/server/auth';
import { FsStore } from '../src/server/fs-store';
import { handlePull, handleSync, type HandlerDeps } from '../src/server/handlers';
import { ApiError, type SyncApi } from '../src/shell/api';

export const ORIGIN = 'https://hub.example';
export const auth: AuthConfig = { secret: 'test-secret', passphrase: 'correct horse battery staple', version: '1' };

export async function tempStore(): Promise<{ dir: string; store: FsStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'artiport-'));
  return { dir, store: new FsStore(dir) };
}

export function depsFor(store: FsStore, now: () => number = Date.now): HandlerDeps {
  return { store: () => store, auth: () => auth, now, sleep: async () => {} };
}

export async function sessionCookie(): Promise<string> {
  return (await createSessionCookie(auth, ORIGIN)).split(';')[0];
}

export async function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Request> {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      cookie: await sessionCookie(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** A SyncApi that calls the real handlers in-process, as a device would over HTTP. */
export function inProcessApi(deps: HandlerDeps, online: () => boolean = () => true): SyncApi {
  const call = async <T>(handler: typeof handleSync, path: string, body: unknown): Promise<T> => {
    if (!online()) throw new TypeError('Failed to fetch');
    const response = await handler(await jsonRequest(path, body), deps);
    const data = (await response.json()) as T & { error?: string; message?: string };
    if (!response.ok) throw new ApiError(response.status, data.error ?? 'error', data.message);
    return data;
  };
  return {
    pull: (body) => call(handlePull, '/api/pull', body),
    sync: (body) => call(handleSync, '/api/sync', body),
  };
}
