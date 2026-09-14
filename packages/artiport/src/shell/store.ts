import type { HostBridge } from '../shared/bridge';
import { decodeValue, encodeValue, normalizeEntry } from '../shared/codec';
import { compareStamps, sameStamp } from '../shared/merge';
import { kvPath, nsKey, slugFromPath, splitNsKey } from '../shared/paths';
import type { Changes, FilePayload, Namespace, PullResponse, Stamp, SyncResponse } from '../shared/types';
import { ApiError, type SyncApi } from './api';
import { recordId, type EntryRecord, type LocalEntry, type Persistence } from './persistence';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  bootstrapped: boolean;
  lastSyncAt: number | null;
  error: string | null;
}

export type StoreEvent = { type: 'status'; status: SyncStatus } | { type: 'remote-change'; slugs: string[] };

export interface StoreOptions {
  api: SyncApi;
  persistence: Persistence;
  /** Quiet period after the last local change before pushing. */
  debounceMs?: number;
  /** Longest a change waits while edits keep coming. */
  maxWaitMs?: number;
  /** Delay before retrying a push that failed for network or server reasons. */
  retryMs?: number;
  /** Push automatically after local changes (tests turn this off). */
  autoFlush?: boolean;
  now?: () => number;
  createDeviceId?: () => string;
}

/**
 * The single source of truth in the browser: an in-memory map of every section's values, mirrored to
 * IndexedDB and synced with the server using last-writer-wins per key.
 */
export class HubStore {
  private readonly files = new Map<string, Map<string, LocalEntry>>();
  private readonly oids = new Map<string, string>();
  private readonly listeners = new Set<(event: StoreEvent) => void>();
  private head: string | null = null;
  private maxSeen = 0;
  private deviceId = '';
  private bootstrapped = false;
  private lastSyncAt: number | null = null;
  private state: SyncState = 'idle';
  private error: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private pendingRecords = new Map<string, EntryRecord>();
  private pendingDeletes = new Set<string>();
  private pendingOids: Record<string, string | null> = {};
  private pendingMeta: Record<string, unknown> = {};
  private persistScheduled = false;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  private constructor(private readonly options: StoreOptions) {
    this.now = options.now ?? Date.now;
  }

  static async open(options: StoreOptions): Promise<HubStore> {
    const store = new HubStore(options);
    await store.load();
    return store;
  }

  // Section API (called synchronously from iframes through the bridge)

  get(slug: string, ns: Namespace, key: string): string | null {
    return decodeValue(this.files.get(kvPath(slug))?.get(nsKey(ns, key)));
  }

  set(slug: string, ns: Namespace, key: string, value: string): void {
    const path = kvPath(slug);
    const stored = nsKey(ns, key);
    // Artifacts often re-save unchanged state on load; that must not create commits.
    if (decodeValue(this.files.get(path)?.get(stored)) === value) return;
    this.writeLocal(path, stored, { ...encodeValue(value), t: this.nextStamp(), dirty: true });
  }

  remove(slug: string, ns: Namespace, key: string): void {
    const path = kvPath(slug);
    const stored = nsKey(ns, key);
    const current = this.files.get(path)?.get(stored);
    if (!current || current.del) return;
    this.writeLocal(path, stored, { del: true, t: this.nextStamp(), dirty: true });
  }

  keys(slug: string, ns: Namespace): string[] {
    const keys: string[] = [];
    for (const [stored, entry] of this.files.get(kvPath(slug)) ?? []) {
      if (entry.del) continue;
      const parsed = splitNsKey(stored);
      if (parsed?.ns === ns) keys.push(parsed.key);
    }
    return keys;
  }

  bridge(report?: (slug: string, message: string) => void): HostBridge {
    return {
      version: 1,
      getItem: (slug, ns, key) => this.get(slug, ns, key),
      setItem: (slug, ns, key, value) => this.set(slug, ns, key, value),
      removeItem: (slug, ns, key) => this.remove(slug, ns, key),
      keys: (slug, ns) => this.keys(slug, ns),
      report,
    };
  }

  // Sync

  status(): SyncStatus {
    return {
      state: this.state,
      pending: this.pendingCount(),
      bootstrapped: this.bootstrapped,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
    };
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  subscribe(listener: (event: StoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fetches what changed on the server. Resolves true when the server answered. */
  pull(): Promise<boolean> {
    return this.exclusive(async () => {
      const response = await this.request(() =>
        this.options.api.pull({ head: this.head, known: Object.fromEntries(this.oids) }),
      );
      if (!response) return false;
      this.applyPull(response);
      return true;
    });
  }

  /** Pushes local changes. With `keepalive` the request survives the page being hidden or closed. */
  flush(options: { keepalive?: boolean } = {}): Promise<void> {
    return this.exclusive(() => this.flushNow(options.keepalive ?? false));
  }

  pendingCount(): number {
    let count = 0;
    for (const map of this.files.values()) for (const entry of map.values()) if (entry.dirty) count++;
    return count;
  }

  /** Resolves once everything queued so far has reached IndexedDB. */
  async persisted(): Promise<void> {
    await Promise.resolve();
    await this.persistChain;
  }

  /** Forgets everything on this device (the server copy is untouched). */
  async wipe(): Promise<void> {
    await this.exclusive(async () => {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.files.clear();
      this.oids.clear();
      this.head = null;
      this.bootstrapped = false;
      this.lastSyncAt = null;
      this.pendingRecords.clear();
      this.pendingDeletes.clear();
      this.pendingOids = {};
      this.pendingMeta = {};
      await this.persistChain;
      await this.options.persistence.clear();
      await this.options.persistence.putMeta({ deviceId: this.deviceId, maxSeen: this.maxSeen });
    });
    this.emitStatus();
  }

  /** Picks up writes another tab made to IndexedDB. */
  async refreshFromDisk(): Promise<void> {
    await this.persisted();
    const saved = await this.options.persistence.load();
    for (const record of saved.entries) {
      const map = this.fileMap(record.path);
      const current = map.get(record.key);
      const order = current ? compareStamps(record.entry.t, current.t) : 1;
      if (order > 0 || (order === 0 && !record.entry.dirty && current?.dirty)) map.set(record.key, record.entry);
    }
    for (const [path, oid] of Object.entries(saved.oids)) this.oids.set(path, oid);
    if (typeof saved.meta.maxSeen === 'number') this.maxSeen = Math.max(this.maxSeen, saved.meta.maxSeen);
    this.emitStatus();
  }

  private async load(): Promise<void> {
    const saved = await this.options.persistence.load();
    for (const record of saved.entries) this.fileMap(record.path).set(record.key, record.entry);
    for (const [path, oid] of Object.entries(saved.oids)) this.oids.set(path, oid);
    const { meta } = saved;
    this.deviceId = typeof meta.deviceId === 'string' ? meta.deviceId : (this.options.createDeviceId ?? randomDeviceId)();
    this.head = typeof meta.head === 'string' ? meta.head : null;
    this.maxSeen = typeof meta.maxSeen === 'number' ? meta.maxSeen : 0;
    this.bootstrapped = meta.bootstrapped === true;
    this.lastSyncAt = typeof meta.lastSyncAt === 'number' ? meta.lastSyncAt : null;
    if (meta.deviceId !== this.deviceId) this.queueMeta({ deviceId: this.deviceId });
    if (this.pendingCount() > 0) this.scheduleFlush();
  }

  private async flushNow(keepalive: boolean): Promise<void> {
    if (!this.bootstrapped) return;
    const changes: Changes = {};
    const sent = new Map<string, Stamp>();
    for (const [path, map] of this.files) {
      for (const [key, entry] of map) {
        if (!entry.dirty) continue;
        (changes[path] ??= {})[key] = normalizeEntry(entry);
        sent.set(recordId(path, key), entry.t);
      }
    }
    if (sent.size === 0) return;
    const response = await this.request(() => this.options.api.sync({ changes }, { keepalive }));
    if (response) this.applySync(response, sent);
    else if (this.state !== 'unauthorized') this.scheduleRetry();
  }

  private applySync(response: SyncResponse, sent: Map<string, Stamp>): void {
    this.observeServerTime(response.now);
    const changed = new Set<string>();
    for (const [path, payload] of Object.entries(response.files)) {
      const map = this.fileMap(path);
      for (const [key, raw] of Object.entries(payload.data.entries)) {
        const remote = normalizeEntry(raw);
        const local = map.get(key);
        if (local?.dirty) {
          const sentStamp = sent.get(recordId(path, key));
          const confirmed = sentStamp !== undefined && sameStamp(local.t, sentStamp);
          // Edited again while the request was in flight: keep the newer local value pending.
          if (!confirmed && compareStamps(local.t, remote.t) >= 0) continue;
        } else if (local && sameStamp(local.t, remote.t)) {
          continue;
        }
        if (decodeValue(local) !== decodeValue(remote)) changed.add(path);
        map.set(key, remote);
        this.queueRecord(path, key, remote);
      }
      this.oids.set(path, payload.oid);
      this.queueOid(path, payload.oid);
    }
    // The head is deliberately left alone: only a pull may advance it, or other files' changes would be skipped.
    this.firstDirtyAt = this.pendingCount() > 0 ? this.now() : null;
    this.emitRemoteChanges(changed);
    this.emitStatus();
  }

  private applyPull(response: PullResponse): void {
    this.observeServerTime(response.now);
    const changed = new Set<string>();
    if (!response.unchanged) {
      for (const [path, payload] of Object.entries(response.files)) this.applyRemoteFile(path, payload, changed);
      for (const path of response.removed) this.applyRemovedFile(path, changed);
    }
    this.head = response.head;
    this.bootstrapped = true;
    this.queueMeta({ head: this.head, bootstrapped: true });
    this.emitRemoteChanges(changed);
    this.emitStatus();
    if (this.pendingCount() > 0) this.scheduleFlush();
  }

  private applyRemoteFile(path: string, payload: FilePayload, changed: Set<string>): void {
    const map = this.fileMap(path);
    const remoteKeys = new Set<string>();
    for (const [key, raw] of Object.entries(payload.data.entries)) {
      remoteKeys.add(key);
      const remote = normalizeEntry(raw);
      const local = map.get(key);
      if (local && compareStamps(local.t, remote.t) >= 0) continue;
      if (decodeValue(local) !== decodeValue(remote)) changed.add(path);
      map.set(key, remote);
      this.queueRecord(path, key, remote);
    }
    // The server file no longer has these keys (rewritten by hand or compacted): follow it.
    for (const [key, local] of map) {
      if (local.dirty || remoteKeys.has(key)) continue;
      if (!local.del) changed.add(path);
      map.delete(key);
      this.queueDelete(path, key);
    }
    this.oids.set(path, payload.oid);
    this.queueOid(path, payload.oid);
  }

  private applyRemovedFile(path: string, changed: Set<string>): void {
    const map = this.files.get(path);
    for (const [key, local] of map ?? []) {
      if (local.dirty) continue;
      if (!local.del) changed.add(path);
      map!.delete(key);
      this.queueDelete(path, key);
    }
    this.oids.delete(path);
    this.queueOid(path, null);
  }

  private writeLocal(path: string, key: string, entry: LocalEntry): void {
    this.fileMap(path).set(key, entry);
    this.queueRecord(path, key, entry);
    this.scheduleFlush();
    this.emitStatus();
  }

  private nextStamp(): Stamp {
    const ms = Math.max(this.now(), this.maxSeen + 1);
    this.maxSeen = ms;
    this.queueMeta({ maxSeen: ms });
    // Before the first pull this device knows nothing: any server value must win over what it writes.
    return [this.bootstrapped ? ms : 0, this.deviceId];
  }

  private observeServerTime(now: number): void {
    if (now <= this.maxSeen) return;
    this.maxSeen = now;
    this.queueMeta({ maxSeen: now });
  }

  private async request<T>(call: () => Promise<T>): Promise<T | null> {
    this.setState('syncing', this.error);
    try {
      const result = await call();
      this.lastSyncAt = this.now();
      this.queueMeta({ lastSyncAt: this.lastSyncAt });
      this.setState('idle', null);
      return result;
    } catch (error) {
      if (error instanceof ApiError) this.setState(error.status === 401 ? 'unauthorized' : 'error', error.message);
      else this.setState('offline', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private scheduleFlush(): void {
    if (this.options.autoFlush === false || !this.bootstrapped) return;
    const now = this.now();
    this.firstDirtyAt ??= now;
    const debounce = this.options.debounceMs ?? 12_000;
    const maxWait = this.options.maxWaitMs ?? 45_000;
    const wait = Math.max(0, Math.min(debounce, this.firstDirtyAt + maxWait - now));
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, wait);
  }

  private scheduleRetry(): void {
    if (this.options.autoFlush === false || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.options.retryMs ?? 30_000);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => withSyncLock(task));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private fileMap(path: string): Map<string, LocalEntry> {
    let map = this.files.get(path);
    if (!map) this.files.set(path, (map = new Map()));
    return map;
  }

  private queueRecord(path: string, key: string, entry: LocalEntry): void {
    const id = recordId(path, key);
    this.pendingDeletes.delete(id);
    this.pendingRecords.set(id, { path, key, entry });
    this.schedulePersist();
  }

  private queueDelete(path: string, key: string): void {
    const id = recordId(path, key);
    this.pendingRecords.delete(id);
    this.pendingDeletes.add(id);
    this.schedulePersist();
  }

  private queueOid(path: string, oid: string | null): void {
    this.pendingOids[path] = oid;
    this.schedulePersist();
  }

  private queueMeta(meta: Record<string, unknown>): void {
    Object.assign(this.pendingMeta, meta);
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistChain = this.persistChain.then(() => this.drainPersist());
    });
  }

  private async drainPersist(): Promise<void> {
    this.persistScheduled = false;
    const records = [...this.pendingRecords.values()];
    const deletes = [...this.pendingDeletes];
    const oids = this.pendingOids;
    const meta = this.pendingMeta;
    this.pendingRecords = new Map();
    this.pendingDeletes = new Set();
    this.pendingOids = {};
    this.pendingMeta = {};
    const { persistence } = this.options;
    try {
      await Promise.all([
        records.length > 0 && persistence.putEntries(records),
        deletes.length > 0 && persistence.deleteEntries(deletes),
        Object.keys(oids).length > 0 && persistence.putOids(oids),
        Object.keys(meta).length > 0 && persistence.putMeta(meta),
      ]);
    } catch (error) {
      console.error('[artiport] saving to IndexedDB failed', error);
    }
  }

  private setState(state: SyncState, error: string | null): void {
    this.state = state;
    this.error = error;
    this.emitStatus();
  }

  private emitStatus(): void {
    const event: StoreEvent = { type: 'status', status: this.status() };
    for (const listener of this.listeners) listener(event);
  }

  private emitRemoteChanges(paths: Set<string>): void {
    const slugs = [...paths].map(slugFromPath).filter((slug): slug is string => slug !== null);
    if (slugs.length === 0) return;
    const event: StoreEvent = { type: 'remote-change', slugs };
    for (const listener of this.listeners) listener(event);
  }
}

function withSyncLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('artiport-sync', task) as Promise<T>) : task();
}

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
