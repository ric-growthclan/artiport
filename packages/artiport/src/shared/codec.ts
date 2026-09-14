import type { DataFile, Entry, Stamp } from './types';

const MAX_DEVICE_ID = 64;

/** Keeps data files readable: strings that are exact JSON are stored parsed, everything else raw. */
export function encodeValue(value: string): { j: unknown } | { v: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (JSON.stringify(parsed) === value) return { j: parsed };
  } catch {
    // not JSON, keep the raw string
  }
  return { v: value };
}

export function decodeValue(entry: Entry | undefined): string | null {
  if (!entry || entry.del) return null;
  if ('j' in entry) return JSON.stringify(entry.j);
  return typeof entry.v === 'string' ? entry.v : null;
}

export function normalizeEntry(entry: Entry): Entry {
  const t: Stamp = [entry.t[0], entry.t[1]];
  if (entry.del) return { del: true, t };
  if ('j' in entry) return { j: entry.j, t };
  return { v: entry.v ?? '', t };
}

export function isStamp(value: unknown): value is Stamp {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    value[0] >= 0 &&
    typeof value[1] === 'string' &&
    value[1].length > 0 &&
    value[1].length <= MAX_DEVICE_ID
  );
}

export function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (!isStamp(entry.t)) return false;
  if (entry.del === true) return true;
  if ('j' in entry) return true;
  return typeof entry.v === 'string';
}

export function emptyFile(): DataFile {
  return { format: 1, entries: {} };
}

export function parseDataFile(text: string | null | undefined): DataFile {
  if (!text) return emptyFile();
  const raw = JSON.parse(text) as Partial<DataFile>;
  if (raw.format !== 1 || typeof raw.entries !== 'object' || raw.entries === null) {
    throw new Error('Unsupported data file format');
  }
  return { format: 1, entries: raw.entries };
}

/**
 * Deterministic serialization: entry keys sorted, fixed field order. `j` payloads keep their own key
 * order so a value decodes back to exactly the string the artifact stored.
 */
export function serializeDataFile(file: DataFile): string {
  const entries: Record<string, Entry> = {};
  for (const key of Object.keys(file.entries).sort()) {
    entries[key] = normalizeEntry(file.entries[key]);
  }
  return JSON.stringify({ format: 1, entries }, null, 2) + '\n';
}
