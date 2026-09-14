/// <reference lib="webworker" />

interface Precache {
  version: string;
  urls: string[];
}

// `artiport build` prepends the precache manifest for this deployment.
const sw = self as unknown as ServiceWorkerGlobalScope & { __ARTIPORT_PRECACHE__: Precache };

const { version, urls } = sw.__ARTIPORT_PRECACHE__;
const CACHE = `artiport-${version}`;
const precached = new Set(urls);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll rejects on any non-2xx response, so an expired session can never cache the login page.
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
      if (!sw.registration.active) await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('artiport-') && key !== CACHE).map((key) => caches.delete(key)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/login')) return;

  const key = url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -'index.html'.length) : url.pathname;
  if (precached.has(key)) {
    event.respondWith(fromCache(key, request));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkOrShell(request));
  }
});

async function fromCache(key: string, request: Request): Promise<Response> {
  return (await caches.match(key, { cacheName: CACHE })) ?? fetch(request);
}

async function networkOrShell(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (error) {
    const shell = await caches.match('/', { cacheName: CACHE });
    if (shell) return shell;
    throw error;
  }
}

export {};
