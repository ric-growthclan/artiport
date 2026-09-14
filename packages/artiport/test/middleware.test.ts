import { beforeEach, describe, expect, it } from 'vitest';
import middleware from '../src/middleware';
import { createSessionCookie } from '../src/server/auth';
import { auth, ORIGIN } from './helpers';

beforeEach(() => {
  process.env.HUB_SESSION_SECRET = auth.secret;
  process.env.HUB_PASSPHRASE = auth.passphrase;
  process.env.HUB_SESSION_VERSION = auth.version;
});

const request = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers });
const passes = (response: Response) => response.headers.get('x-middleware-next') === '1';

describe('middleware', () => {
  it('redirects page navigations without a session to the login page', async () => {
    const response = await middleware(request('/sections/habits/', { 'sec-fetch-mode': 'navigate' }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login/?next=%2Fsections%2Fhabits%2F`);
  });

  it('answers 401 to everything else, so the service worker never caches the login page', async () => {
    const asset = await middleware(request('/shell.abc123.js', { 'sec-fetch-mode': 'no-cors' }));
    expect(asset.status).toBe(401);
    expect((await middleware(request('/api/pull'))).status).toBe(401);
  });

  it('lets public paths through', async () => {
    for (const path of ['/login/', '/api/login', '/manifest.webmanifest', '/icons/icon-192.png', '/apple-touch-icon.png']) {
      expect(passes(await middleware(request(path))), path).toBe(true);
    }
  });

  it('lets signed-in requests through and rejects forged or revoked sessions', async () => {
    const cookie = (await createSessionCookie(auth, ORIGIN)).split(';')[0];
    expect(passes(await middleware(request('/', { cookie, 'sec-fetch-mode': 'navigate' })))).toBe(true);

    const forged = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
    expect((await middleware(request('/', { cookie: forged, 'sec-fetch-mode': 'navigate' }))).status).toBe(302);

    process.env.HUB_SESSION_VERSION = '2';
    expect((await middleware(request('/api/pull', { cookie }))).status).toBe(401);
  });

  it('fails closed when the secrets are missing', async () => {
    delete process.env.HUB_SESSION_SECRET;
    const response = await middleware(request('/', { 'sec-fetch-mode': 'navigate' }));
    expect(response.status).toBe(500);
    expect(passes(response)).toBe(false);
  });
});
