/** Wall-clock milliseconds (never below the last value seen) plus the id of the device that wrote. */
export type Stamp = [ms: number, device: string];

/**
 * One stored value. `j` holds parsed JSON when the original string survives a round trip unchanged,
 * otherwise `v` holds the raw string. A tombstone has `del` and no value.
 */
export interface Entry {
  j?: unknown;
  v?: string;
  t: Stamp;
  del?: true;
}

export interface DataFile {
  format: 1;
  entries: Record<string, Entry>;
}

/** Storage namespaces inside a section's kv file: localStorage, window.storage (personal), window.storage (shared). */
export type Namespace = 'ls' | 'ws' | 'wss';

/** path → key → entry */
export type Changes = Record<string, Record<string, Entry>>;

export interface FilePayload {
  oid: string;
  data: DataFile;
}

export interface SyncRequest {
  changes: Changes;
}

export interface SyncResponse {
  head: string | null;
  now: number;
  files: Record<string, FilePayload>;
}

export interface PullRequest {
  head?: string | null;
  known: Record<string, string>;
}

export type PullResponse =
  | { unchanged: true; head: string | null; now: number }
  | {
      unchanged: false;
      head: string | null;
      now: number;
      files: Record<string, FilePayload>;
      removed: string[];
    };
