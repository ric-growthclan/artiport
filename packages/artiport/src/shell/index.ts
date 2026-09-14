import { postJson, httpApi } from './api';
import { messages } from './i18n';
import { IdbPersistence, MemoryPersistence, type Persistence } from './persistence';
import { HubStore, type StoreEvent, type SyncStatus } from './store';
import './styles.css';

export interface SectionInfo {
  slug: string;
  title: string;
  emoji: string;
}

export interface ShellConfig {
  title: string;
  lang: string;
  version: string;
  dev: boolean;
  sections: SectionInfo[];
}

declare global {
  interface Window {
    __ARTIPORT_CONFIG__: ShellConfig;
  }
}

type Route =
  | { kind: 'home' }
  | { kind: 'settings' }
  | { kind: 'section'; section: SectionInfo }
  | { kind: 'missing' };

type Child = Node | string | null | false | undefined;

const config = window.__ARTIPORT_CONFIG__;
const text = messages(config.lang);
const diagnostics = new Set<string>();
const RESYNC_THROTTLE_MS = 10_000;

let store: HubStore;
let frame: HTMLIFrameElement | null = null;
let frameSlug: string | null = null;
let routing = false;
let lifecycleWired = false;
let lastResync = 0;
let registration: ServiceWorkerRegistration | undefined;
let reloadOnControllerChange = false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value as EventListener);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

function icon(svg: string): HTMLElement {
  const span = h('span', { class: 'nav-icon', 'aria-hidden': 'true' });
  span.innerHTML = svg;
  return span;
}

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

function buildLayout() {
  const items = h('nav', { class: 'nav-items', 'aria-label': text.sections });
  for (const section of config.sections) {
    items.append(
      h(
        'a',
        { class: 'nav-item', href: `#/${section.slug}`, 'data-route': section.slug },
        h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, section.emoji || '•'),
        h('span', { class: 'nav-label' }, section.title),
      ),
    );
  }
  const settings = h(
    'a',
    { class: 'nav-item nav-settings', href: '#/settings', 'data-route': 'settings' },
    icon(GEAR_SVG),
    h('span', { class: 'nav-label' }, text.settings),
  );
  const nav = h('aside', { class: 'nav' }, h('a', { class: 'nav-brand', href: '#/' }, config.title), items, settings);
  const title = h('h1', { class: 'topbar-title' }, config.title);
  const syncLabel = h('span', { class: 'sync-label' });
  const sync = h(
    'button',
    { class: 'sync', type: 'button', onclick: () => (location.hash = '#/settings') },
    h('span', { class: 'sync-dot', 'aria-hidden': 'true' }),
    syncLabel,
  );
  const banner = h('div', { class: 'banner', role: 'status', hidden: true });
  const view = h('main', { class: 'view' });
  const topbar = h('header', { class: 'topbar' }, h('a', { class: 'topbar-home', href: '#/' }, title), sync);
  document.getElementById('app')!.replaceChildren(h('div', { class: 'app' }, nav, h('div', { class: 'main' }, topbar, banner, view)));
  return { nav, title, sync, syncLabel, banner, view };
}

async function boot(): Promise<void> {
  ui.view.replaceChildren(h('div', { class: 'boot' }, h('div', { class: 'spinner' }), h('p', {}, text.loading)));
  let persistence: Persistence;
  try {
    persistence = await IdbPersistence.open();
  } catch {
    persistence = new MemoryPersistence();
    diagnostics.add(text.noIndexedDb);
  }
  store = await HubStore.open({ api: httpApi(), persistence });
  window.__artiport = store.bridge((slug, message) => diagnostics.add(`${slug}: ${message}`));
  store.subscribe(onStoreEvent);
  updateSyncIndicator(store.status());
  wireLifecycle();
  void registerServiceWorker();

  if (store.isBootstrapped()) {
    startRouting();
    void store.pull();
  } else {
    await firstSync();
  }
}

/** A device that has never synced must see the server's data before any section can write. */
async function firstSync(): Promise<void> {
  ui.view.replaceChildren(h('div', { class: 'boot' }, h('div', { class: 'spinner' }), h('p', {}, text.loading)));
  if (await store.pull()) {
    startRouting();
    return;
  }
  if (store.status().state === 'unauthorized') {
    location.replace('/login/');
    return;
  }
  ui.view.replaceChildren(
    h(
      'div',
      { class: 'boot' },
      h('p', { class: 'boot-title' }, text.firstSyncFailed),
      h('p', { class: 'boot-hint' }, text.firstSyncHint),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'button primary', type: 'button', onclick: () => void firstSync() }, text.retry),
        h('button', { class: 'button', type: 'button', onclick: startRouting }, text.useOffline),
      ),
    ),
  );
}

function startRouting(): void {
  if (!routing) {
    routing = true;
    window.addEventListener('hashchange', render);
  }
  render();
}

function parseRoute(): Route {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!raw) return config.sections.length === 1 ? { kind: 'section', section: config.sections[0] } : { kind: 'home' };
  if (raw === 'settings') return { kind: 'settings' };
  const section = config.sections.find((candidate) => candidate.slug === raw);
  return section ? { kind: 'section', section } : { kind: 'missing' };
}

function render(): void {
  const route = parseRoute();
  const active = route.kind === 'section' ? route.section.slug : route.kind === 'settings' ? 'settings' : null;
  for (const link of ui.nav.querySelectorAll<HTMLAnchorElement>('[data-route]')) {
    if (link.dataset.route === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  if (route.kind === 'section') {
    setTitle(route.section.title);
    if (frameSlug !== route.section.slug) mountSection(route.section);
    return;
  }
  frame = null;
  frameSlug = null;
  if (route.kind === 'settings') {
    setTitle(text.settings);
    renderSettings();
  } else if (route.kind === 'missing') {
    setTitle(config.title);
    ui.view.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, text.missingSection)));
  } else {
    setTitle(config.title);
    renderHome();
  }
}

function setTitle(title: string): void {
  ui.title.textContent = title;
  document.title = title === config.title ? title : `${title} · ${config.title}`;
}

function mountSection(section: SectionInfo): void {
  frame = h('iframe', {
    class: 'section-frame',
    src: `/sections/${section.slug}/`,
    title: section.title,
    allow: 'clipboard-read; clipboard-write; fullscreen',
  });
  frameSlug = section.slug;
  ui.view.replaceChildren(frame);
}

function renderHome(): void {
  if (config.sections.length === 0) {
    ui.view.replaceChildren(
      h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, text.noSections), h('p', {}, text.noSectionsHint)),
    );
    return;
  }
  ui.view.replaceChildren(
    h(
      'div',
      { class: 'home' },
      h('h2', {}, config.title),
      h(
        'div',
        { class: 'tiles' },
        ...config.sections.map((section) =>
          h(
            'a',
            { class: 'tile', href: `#/${section.slug}` },
            h('span', { class: 'tile-emoji', 'aria-hidden': 'true' }, section.emoji || '•'),
            h('span', { class: 'tile-title' }, section.title),
          ),
        ),
      ),
    ),
  );
}

function renderSettings(): void {
  const status = store.status();
  const syncRows: [string, string][] = [
    [text.status, statusLabel(status)],
    [text.pendingChanges, String(status.pending)],
    [text.lastSync, status.lastSyncAt ? formatTime(status.lastSyncAt) : '—'],
  ];
  if (status.error && status.state !== 'idle') syncRows.push([text.lastError, status.error]);
  const deviceRows: [string, string][] = [[text.version, config.version]];
  for (const line of diagnostics) deviceRows.push([text.diagnostics, line]);

  ui.view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      card(
        text.sync,
        syncRows,
        h('div', { class: 'actions' }, h('button', { class: 'button primary', type: 'button', onclick: () => void syncNow() }, text.syncNow)),
      ),
      isStandalone() ? null : card(text.install, [], h('p', { class: 'hint' }, isIos() ? text.installIos : text.installOther)),
      card(
        text.device,
        deviceRows,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'button', type: 'button', onclick: () => void logout() }, text.logout),
          h('button', { class: 'button danger', type: 'button', onclick: () => void wipeDevice() }, text.wipe),
        ),
      ),
    ),
  );
}

function card(title: string, rows: [string, string][], footer?: Child): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, title),
    ...rows.map(([label, value]) => h('div', { class: 'row' }, h('span', { class: 'row-label' }, label), h('span', { class: 'row-value' }, value))),
    footer,
  );
}

function onStoreEvent(event: StoreEvent): void {
  if (event.type === 'remote-change') {
    // The open artifact holds the old values in memory; reload it before it saves them back.
    if (frame && frameSlug && event.slugs.includes(frameSlug)) frame.contentWindow?.location.reload();
    return;
  }
  updateSyncIndicator(event.status);
  if (event.status.state === 'unauthorized') {
    showBanner(text.sessionExpired, { label: text.login, run: () => location.assign('/login/') });
  } else if (ui.banner.dataset.kind === 'session') {
    hideBanner();
  }
  if (routing && parseRoute().kind === 'settings') renderSettings();
}

function updateSyncIndicator(status: SyncStatus): void {
  const label = statusLabel(status);
  ui.sync.dataset.state = status.state;
  ui.sync.dataset.pending = String(status.pending);
  ui.syncLabel.textContent = label;
  ui.sync.title = label;
  ui.sync.setAttribute('aria-label', label);
}

function statusLabel(status: SyncStatus): string {
  switch (status.state) {
    case 'syncing':
      return text.syncing;
    case 'offline':
      return status.pending ? text.offlinePending(status.pending) : text.offline;
    case 'unauthorized':
      return text.sessionExpired;
    case 'error':
      return text.syncError;
    default:
      return status.pending ? text.pending(status.pending) : text.synced;
  }
}

function showBanner(message: string, action?: { label: string; run: () => void }, kind = 'session'): void {
  ui.banner.dataset.kind = kind;
  ui.banner.replaceChildren(h('span', { class: 'banner-text' }, message));
  if (action) ui.banner.append(h('button', { class: 'button primary small', type: 'button', onclick: action.run }, action.label));
  ui.banner.hidden = false;
}

function hideBanner(): void {
  ui.banner.hidden = true;
  delete ui.banner.dataset.kind;
}

async function syncNow(): Promise<void> {
  await store.flush();
  await store.pull();
}

async function logout(): Promise<void> {
  await store.flush();
  try {
    await postJson('/api/logout', {});
  } finally {
    location.replace('/login/');
  }
}

async function wipeDevice(): Promise<void> {
  if (!confirm(text.wipeConfirm(store.pendingCount()))) return;
  await store.wipe();
  location.reload();
}

function wireLifecycle(): void {
  if (lifecycleWired) return;
  lifecycleWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void store.flush({ keepalive: true });
    else void resync();
  });
  window.addEventListener('pagehide', () => void store.flush({ keepalive: true }));
  window.addEventListener('online', () => void resync(true));
  window.addEventListener('focus', () => void resync());
}

async function resync(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastResync < RESYNC_THROTTLE_MS) return;
  lastResync = now;
  await store.refreshFromDisk();
  await store.flush();
  await store.pull();
  registration?.update().catch(() => undefined);
}

async function registerServiceWorker(): Promise<void> {
  if (config.dev || !('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    diagnostics.add(`service worker: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const offerUpdate = (worker: ServiceWorker) =>
    showBanner(
      text.updateReady,
      {
        label: text.reload,
        run: async () => {
          await store.flush({ keepalive: true });
          reloadOnControllerChange = true;
          worker.postMessage('skip-waiting');
        },
      },
      'update',
    );
  if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration?.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(config.lang, { dateStyle: 'short', timeStyle: 'short' }).format(ms);
}

function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Last, so every module-level constant above is initialised before the UI is built.
const ui = buildLayout();
void boot();
