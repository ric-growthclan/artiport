import type { Namespace } from './types';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const KV_PATH_PATTERN = /^sections\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/kv\.json$/;
const NAMESPACES: readonly Namespace[] = ['ls', 'ws', 'wss'];

export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function kvPath(slug: string): string {
  return `sections/${slug}/kv.json`;
}

/** Paths a browser may read and write through the sync API. */
export function isSyncPath(path: string): boolean {
  return KV_PATH_PATTERN.test(path);
}

export function slugFromPath(path: string): string | null {
  return KV_PATH_PATTERN.exec(path)?.[1] ?? null;
}

export function nsKey(ns: Namespace, key: string): string {
  return `${ns}:${key}`;
}

export function splitNsKey(stored: string): { ns: Namespace; key: string } | null {
  const colon = stored.indexOf(':');
  if (colon < 0) return null;
  const ns = stored.slice(0, colon) as Namespace;
  if (!NAMESPACES.includes(ns)) return null;
  return { ns, key: stored.slice(colon + 1) };
}
