import { memoryBridge, type HostBridge } from '../shared/bridge';
import { installClaude } from './claude-use';
import { installLocalStorage } from './storage-proxy';
import { installWindowStorage } from './window-storage';

// Injected as the first script of every section page, before any artifact code runs.

declare global {
  interface Window {
    __ARTIPORT_SLUG__?: string;
    __artiport?: HostBridge;
  }
}

function findBridge(): HostBridge | null {
  try {
    if (window.parent === window) return null;
    const bridge = window.parent.__artiport;
    return bridge && bridge.version === 1 ? bridge : null;
  } catch {
    return null;
  }
}

const slug = window.__ARTIPORT_SLUG__;
if (slug) {
  let bridge = findBridge();
  if (!bridge) {
    // Opened outside the shell: send the visitor into the app so data goes through the synced store.
    if (window.top === window) location.replace(`/#/${encodeURIComponent(slug)}`);
    bridge = memoryBridge();
  }
  installLocalStorage(bridge, slug);
  installWindowStorage(bridge, slug);
  installClaude();
}
