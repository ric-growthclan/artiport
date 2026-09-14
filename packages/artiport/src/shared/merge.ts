import { normalizeEntry } from './codec';
import type { DataFile, Entry, Stamp } from './types';

export function compareStamps(a: Stamp, b: Stamp): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] === b[1]) return 0;
  return a[1] < b[1] ? -1 : 1;
}

export function sameStamp(a: Stamp, b: Stamp): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Applies incoming entries with last-writer-wins per key. Stamps ahead of `now` are clamped so a
 * device with a fast clock cannot shadow later writes from the others.
 */
export function mergeIncoming(
  file: DataFile,
  incoming: Record<string, Entry>,
  now: number,
): { file: DataFile; changed: boolean } {
  const entries = { ...file.entries };
  let changed = false;
  for (const [key, raw] of Object.entries(incoming)) {
    const clamped: Entry = raw.t[0] > now ? { ...raw, t: [now, raw.t[1]] } : raw;
    const entry = normalizeEntry(clamped);
    const current = entries[key];
    if (current && compareStamps(entry.t, current.t) <= 0) continue;
    entries[key] = entry;
    changed = true;
  }
  return { file: { format: 1, entries }, changed };
}
