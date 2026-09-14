import type { HostBridge } from '../shared/bridge';

const NS = 'ls';

/**
 * A Storage look-alike backed by the shell store. Methods, `length`, property access
 * (`localStorage.foo`), `in`, `delete` and `Object.keys` all behave like the native object.
 */
export function createStorageProxy(bridge: HostBridge, slug: string): Storage {
  const keys = () => Array.from(bridge.keys(slug, NS));
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    getItem: (key) => bridge.getItem(slug, NS, String(key)),
    setItem: (key, value) => bridge.setItem(slug, NS, String(key), String(value)),
    removeItem: (key) => bridge.removeItem(slug, NS, String(key)),
    clear: () => {
      for (const key of keys()) bridge.removeItem(slug, NS, key);
    },
    key: (index) => keys()[Math.trunc(Number(index))] ?? null,
  };
  const isReserved = (prop: string) => prop === 'length' || Object.prototype.hasOwnProperty.call(methods, prop);

  return new Proxy(Object.create(Storage.prototype) as Storage, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return prop === Symbol.toStringTag ? 'Storage' : undefined;
      if (prop === 'length') return keys().length;
      if (Object.prototype.hasOwnProperty.call(methods, prop)) return methods[prop];
      if (prop === 'constructor') return Storage;
      if (prop in Object.prototype) return (Object.prototype as unknown as Record<string, unknown>)[prop];
      return bridge.getItem(slug, NS, prop) ?? undefined;
    },
    set(_target, prop, value) {
      if (typeof prop === 'string' && !isReserved(prop)) bridge.setItem(slug, NS, prop, String(value));
      return true;
    },
    has(_target, prop) {
      if (typeof prop === 'symbol') return false;
      return isReserved(prop) || bridge.getItem(slug, NS, prop) !== null;
    },
    deleteProperty(_target, prop) {
      if (typeof prop === 'string' && !isReserved(prop)) bridge.removeItem(slug, NS, prop);
      return true;
    },
    ownKeys() {
      return keys();
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      const value = bridge.getItem(slug, NS, prop);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty(_target, prop, descriptor) {
      if (typeof prop === 'string' && !isReserved(prop) && 'value' in descriptor) {
        bridge.setItem(slug, NS, prop, String(descriptor.value));
      }
      return true;
    },
  });
}

/** Replaces `window.localStorage` for this frame. Returns false (and reports it) when the browser refuses. */
export function installLocalStorage(bridge: HostBridge, slug: string): boolean {
  const proxy = createStorageProxy(bridge, slug);
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => proxy });
  } catch {
    // checked below
  }
  const ok = window.localStorage === proxy;
  if (!ok) bridge.report?.(slug, 'localStorage override failed');
  return ok;
}
