import type { HostBridge } from '../shared/bridge';
import type { Namespace } from '../shared/types';

export interface WindowStorage {
  get(key: string, shared?: boolean): Promise<{ key: string; value: string; shared: boolean }>;
  set(key: string, value: unknown, shared?: boolean): Promise<{ key: string; value: string; shared: boolean }>;
  delete(key: string, shared?: boolean): Promise<{ key: string; deleted: boolean; shared: boolean }>;
  list(prefix?: string, shared?: boolean): Promise<{ keys: string[]; prefix?: string; shared: boolean }>;
}

/**
 * The claude.ai chat artifact storage API. Personal and shared data map to separate namespaces of the
 * same section; reading a missing key rejects, as it does on claude.ai.
 */
export function createWindowStorage(bridge: HostBridge, slug: string): WindowStorage {
  const ns = (shared: boolean): Namespace => (shared ? 'wss' : 'ws');
  return {
    async get(key, shared = false) {
      const value = bridge.getItem(slug, ns(shared), String(key));
      if (value === null) throw new Error(`Key not found: ${key}`);
      return { key, value, shared };
    },
    async set(key, value, shared = false) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      bridge.setItem(slug, ns(shared), String(key), text);
      return { key, value: text, shared };
    },
    async delete(key, shared = false) {
      const existed = bridge.getItem(slug, ns(shared), String(key)) !== null;
      bridge.removeItem(slug, ns(shared), String(key));
      return { key, deleted: existed, shared };
    },
    async list(prefix, shared = false) {
      const keys = Array.from(bridge.keys(slug, ns(shared)))
        .filter((key) => !prefix || key.startsWith(prefix))
        .sort();
      return { keys, prefix, shared };
    },
  };
}

export function installWindowStorage(bridge: HostBridge, slug: string): void {
  Object.defineProperty(window, 'storage', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: createWindowStorage(bridge, slug),
  });
}
