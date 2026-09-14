import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import middleware from '../middleware';
import { authFromEnv, createSessionCookie } from '../server/auth';
import { handleLogin, handleLogout, handlePull, handleSession, handleSync, type HandlerDeps } from '../server/handlers';
import { storeFromEnv } from '../server/store-env';
import { build } from './build';
import { generateSecrets } from './secrets';

export interface DevOptions {
  port: number;
  /** Treat every local request as signed in (development only; deployments always require the passphrase). */
  skipAuth?: boolean;
  clientDir?: string;
  log?: (line: string) => void;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'http2-settings']);

/** Serves the built app, the API and the middleware the way Vercel does, with a local folder as data store. */
export async function dev(root: string, options: DevOptions): Promise<Server> {
  const log = options.log ?? ((line: string) => console.log(line));
  try {
    process.loadEnvFile(join(root, '.env.local'));
  } catch {
    // optional
  }
  if (!process.env.HUB_PASSPHRASE || !process.env.HUB_SESSION_SECRET) {
    const secrets = generateSecrets();
    process.env.HUB_PASSPHRASE ||= secrets.HUB_PASSPHRASE;
    process.env.HUB_SESSION_SECRET ||= secrets.HUB_SESSION_SECRET;
    log(`No secrets in .env.local: temporary passphrase ${process.env.HUB_PASSPHRASE}`);
  }
  if (!process.env.ARTIPORT_DATA_REPO && !process.env.ARTIPORT_FS_DATA_DIR) process.env.ARTIPORT_FS_DATA_DIR = '.artiport-data';
  if (process.env.ARTIPORT_FS_DATA_DIR) process.env.ARTIPORT_FS_DATA_DIR = resolve(root, process.env.ARTIPORT_FS_DATA_DIR);

  const skipAuth = options.skipAuth ?? process.env.ARTIPORT_DEV_SKIP_AUTH === '1';
  const devCookie = skipAuth
    ? (await createSessionCookie(authFromEnv(), `http://localhost:${options.port}`)).split(';')[0]
    : null;

  const outDir = join(root, '.artiport', 'dev');
  const rebuild = async () => {
    try {
      const result = await build(root, { outDir, dev: true, clientDir: options.clientDir });
      log(`built ${result.sections.length} section(s)`);
    } catch (error) {
      log(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await rebuild();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  for (const target of ['sections', 'public', 'hub.config.json']) {
    try {
      watchers.push(
        watch(join(root, target), { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => void rebuild(), 150);
        }),
      );
    } catch {
      // not present
    }
  }

  const deps: HandlerDeps = { store: () => storeFromEnv(), auth: () => authFromEnv() };
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    'POST /api/sync': (request) => handleSync(request, deps),
    'POST /api/pull': (request) => handlePull(request, deps),
    'POST /api/login': (request) => handleLogin(request, deps),
    'POST /api/logout': (request) => handleLogout(request),
    'GET /api/session': (request) => handleSession(request, deps),
  };

  const respond = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const request = await toRequest(req, options.port, devCookie);
      const gate = await middleware(request);
      if (!gate.headers.has('x-middleware-next')) return await send(res, gate);
      const url = new URL(request.url);
      const route = routes[`${request.method} ${url.pathname}`];
      if (route) return await send(res, await route(request));
      if (url.pathname.startsWith('/api/')) return await send(res, new Response('Not found', { status: 404 }));
      await send(res, await serveStatic(outDir, url.pathname));
    } catch (error) {
      await send(res, new Response(`artiport dev: ${error instanceof Error ? error.message : String(error)}`, { status: 500 }));
    }
  };

  const server = createServer((req, res) => void respond(req, res));
  server.on('close', () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  });
  await new Promise<void>((ready) => server.listen(options.port, ready));
  const data = process.env.ARTIPORT_DATA_REPO ?? process.env.ARTIPORT_FS_DATA_DIR;
  log(`artiport dev → http://localhost:${options.port}  (data: ${data})`);
  if (skipAuth) log('Sign-in skipped: every local request is treated as signed in.');
  return server;
}

async function toRequest(req: IncomingMessage, port: number, devCookie: string | null): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  if (devCookie) headers.set('cookie', [headers.get('cookie'), devCookie].filter(Boolean).join('; '));
  const method = req.method ?? 'GET';
  const chunks: Buffer[] = [];
  if (method !== 'GET' && method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk as Buffer);
  }
  const url = `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? '/'}`;
  return new Request(url, { method, headers, body: chunks.length > 0 ? Buffer.concat(chunks) : undefined });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie' && !name.startsWith('x-middleware-')) res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(dir: string, pathname: string): Promise<Response> {
  const base = resolve(dir);
  const relativePath = decodeURIComponent(pathname).replace(/\/$/, '/index.html');
  const file = resolve(base, `.${relativePath}`);
  if (file !== base && !file.startsWith(base + sep)) return new Response('Forbidden', { status: 403 });
  try {
    if ((await stat(file)).isDirectory()) return new Response(null, { status: 308, headers: { location: `${pathname}/` } });
    const body = await readFile(file);
    return new Response(body as unknown as BodyInit, {
      headers: { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
