import { next } from '@vercel/functions';
import { authFromEnv, hasValidSession } from './server/auth';

/** Reachable without a session: the login flow, install metadata, and endpoints that carry their own token. */
const PUBLIC_PATHS = [
  /^\/login(?:\/|\/index\.html)?$/,
  /^\/api\/login$/,
  /^\/manifest\.webmanifest$/,
  /^\/icons\//,
  /^\/favicon\.(?:ico|png|svg)$/,
  /^\/apple-touch-icon(?:-[\w-]+)?\.png$/,
  /^\/api\/cal\/[^/]+\.ics$/,
  /^\/api\/cron\//,
];

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (PUBLIC_PATHS.some((pattern) => pattern.test(url.pathname))) return next();

  let authenticated: boolean;
  try {
    authenticated = await hasValidSession(request, authFromEnv());
  } catch {
    return new Response('artiport is not configured: set HUB_SESSION_SECRET and HUB_PASSPHRASE', { status: 500 });
  }
  if (authenticated) return next();

  if (isNavigation(request)) {
    const login = new URL('/login/', url);
    if (url.pathname !== '/') login.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(login, 302);
  }
  // A 401 rather than a redirect, so the service worker never caches the login page in place of an asset.
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isNavigation(request: Request): boolean {
  const mode = request.headers.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  return request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
}
