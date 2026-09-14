import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasValidSession } from '../src/server/auth';
import { handleLogin, handlePull, handleSession, handleSync } from '../src/server/handlers';
import { auth, depsFor, jsonRequest, ORIGIN, tempStore } from './helpers';

const entry = (v: string, ms: number) => ({ v, t: [ms, 'dev-a'] });

describe('login and sessions', () => {
  it('sets a session cookie for the right passphrase only', async () => {
    const { store } = await tempStore();
    const deps = depsFor(store);

    const wrong = await handleLogin(await jsonRequest('/api/login', { passphrase: 'nope' }, { cookie: '' }), deps);
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const right = await handleLogin(await jsonRequest('/api/login', { passphrase: auth.passphrase }, { cookie: '' }), deps);
    expect(right.status).toBe(200);
    const cookie = right.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-hub_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);

    const request = new Request(`${ORIGIN}/api/session`, { headers: { cookie: cookie.split(';')[0] } });
    expect(await hasValidSession(request, auth)).toBe(true);
    expect(await hasValidSession(request, { ...auth, version: '2' })).toBe(false);
    expect((await handleSession(request, deps)).status).toBe(200);
  });

  it('rejects requests without a session, cross-site writes and bad paths', async () => {
    const { store } = await tempStore();
    const deps = depsFor(store);
    const body = { changes: { 'sections/demo/kv.json': { 'ls:x': entry('1', 1) } } };

    expect((await handleSync(await jsonRequest('/api/sync', body, { cookie: '' }), deps)).status).toBe(401);
    expect((await handleSync(await jsonRequest('/api/sync', body, { 'sec-fetch-site': 'cross-site' }), deps)).status).toBe(403);
    expect((await handleSync(await jsonRequest('/api/sync', body, { origin: 'https://evil.example' }), deps)).status).toBe(403);
    const escape = { changes: { '../secrets/kv.json': { 'ls:x': entry('1', 1) } } };
    expect((await handleSync(await jsonRequest('/api/sync', escape), deps)).status).toBe(400);
    const malformed = { changes: { 'sections/demo/kv.json': { 'ls:x': { v: 1, t: [1] } } } };
    expect((await handleSync(await jsonRequest('/api/sync', malformed), deps)).status).toBe(400);
  });
});

describe('sync and pull', () => {
  it('commits merged files and serves them to a pull', async () => {
    const { dir, store } = await tempStore();
    const deps = depsFor(store, () => 10_000);
    const body = { changes: { 'sections/demo/kv.json': { 'ls:list': { j: [1, 2], t: [5000, 'dev-a'] } } } };

    const synced = await handleSync(await jsonRequest('/api/sync', body), deps);
    expect(synced.status).toBe(200);
    const result = (await synced.json()) as { head: string; files: Record<string, { oid: string }> };
    const onDisk = await readFile(join(dir, 'sections/demo/kv.json'), 'utf8');
    expect(JSON.parse(onDisk).entries['ls:list'].j).toEqual([1, 2]);

    const pulled = await handlePull(await jsonRequest('/api/pull', { head: null, known: {} }), deps);
    const pull = (await pulled.json()) as { head: string; files: Record<string, { oid: string }>; unchanged: boolean };
    expect(pull.unchanged).toBe(false);
    expect(pull.files['sections/demo/kv.json'].oid).toBe(result.files['sections/demo/kv.json'].oid);

    const again = await handlePull(await jsonRequest('/api/pull', { head: pull.head, known: {} }), deps);
    expect(await again.json()).toMatchObject({ unchanged: true, head: pull.head });
  });

  it('does not commit when nothing changes', async () => {
    const { store } = await tempStore();
    const deps = depsFor(store, () => 10_000);
    const body = { changes: { 'sections/demo/kv.json': { 'ls:x': entry('same', 100) } } };
    const first = (await (await handleSync(await jsonRequest('/api/sync', body), deps)).json()) as { head: string };
    const second = (await (await handleSync(await jsonRequest('/api/sync', body), deps)).json()) as { head: string };
    expect(second.head).toBe(first.head);
  });

  it('never loses a write when two syncs race', async () => {
    const { store } = await tempStore();
    const deps = depsFor(store, () => 10_000);
    const path = 'sections/demo/kv.json';
    await Promise.all([
      handleSync(await jsonRequest('/api/sync', { changes: { [path]: { 'ls:a': entry('A', 1) } } }), deps),
      handleSync(await jsonRequest('/api/sync', { changes: { [path]: { 'ls:b': entry('B', 2) } } }), deps),
    ]);
    const pull = (await (await handlePull(await jsonRequest('/api/pull', { known: {} }), deps)).json()) as {
      files: Record<string, { data: { entries: Record<string, unknown> } }>;
    };
    expect(Object.keys(pull.files[path].data.entries).sort()).toEqual(['ls:a', 'ls:b']);
  });
});
