import { describe, expect, it } from 'vitest';
import { MemoryPersistence } from '../src/shell/persistence';
import { HubStore, type StoreEvent } from '../src/shell/store';
import { depsFor, inProcessApi, tempStore } from './helpers';

interface Clock {
  now: () => number;
  advance(ms: number): void;
}

function clock(start: number): Clock {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
}

async function device(deps: ReturnType<typeof depsFor>, id: string, time: Clock, online = () => true) {
  const persistence = new MemoryPersistence();
  const store = await HubStore.open({
    api: inProcessApi(deps, online),
    persistence,
    autoFlush: false,
    now: time.now,
    createDeviceId: () => id,
  });
  const events: StoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  const remoteChanges = () => events.filter((e) => e.type === 'remote-change').flatMap((e) => (e.type === 'remote-change' ? e.slugs : []));
  return { store, persistence, remoteChanges };
}

describe('HubStore sync between devices', () => {
  it('propagates a change from one device to another', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time);
    const laptop = await device(deps, 'laptop', time);

    expect(await phone.store.pull()).toBe(true);
    phone.store.set('diet', 'ws', 'plan', '{"meals":3}');
    expect(phone.store.pendingCount()).toBe(1);
    await phone.store.flush();
    expect(phone.store.pendingCount()).toBe(0);

    expect(await laptop.store.pull()).toBe(true);
    expect(laptop.store.get('diet', 'ws', 'plan')).toBe('{"meals":3}');
    expect(laptop.remoteChanges()).toEqual(['diet']);
  });

  it('lets the newest write win and tells the loser to reload', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time);
    const laptop = await device(deps, 'laptop', time);
    await phone.store.pull();
    await laptop.store.pull();

    phone.store.set('demo', 'ls', 'list', '["milk"]');
    time.advance(1000);
    laptop.store.set('demo', 'ls', 'list', '["eggs"]');
    await laptop.store.flush();
    await phone.store.flush();

    expect(phone.store.get('demo', 'ls', 'list')).toBe('["eggs"]');
    expect(phone.remoteChanges()).toEqual(['demo']);
    await laptop.store.pull();
    expect(laptop.store.get('demo', 'ls', 'list')).toBe('["eggs"]');
  });

  it('never lets a brand-new device overwrite server data', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time);
    await phone.store.pull();
    phone.store.set('demo', 'ls', 'list', '["real data"]');
    await phone.store.flush();

    // The new device opens offline and the artifact initialises an empty list.
    time.advance(60_000);
    const tablet = await device(deps, 'tablet', time);
    tablet.store.set('demo', 'ls', 'list', '[]');
    tablet.store.set('demo', 'ls', 'only-here', 'kept');
    await tablet.store.flush(); // ignored until the first pull
    expect(tablet.store.pendingCount()).toBe(2);

    await tablet.store.pull();
    expect(tablet.store.get('demo', 'ls', 'list')).toBe('["real data"]');
    await tablet.store.flush();

    await phone.store.pull();
    expect(phone.store.get('demo', 'ls', 'list')).toBe('["real data"]');
    expect(phone.store.get('demo', 'ls', 'only-here')).toBe('kept');
  });

  it('ignores writes that do not change the value', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const phone = await device(depsFor(server, time.now), 'phone', time);
    await phone.store.pull();
    phone.store.set('demo', 'ls', 'state', '{}');
    await phone.store.flush();
    phone.store.set('demo', 'ls', 'state', '{}');
    phone.store.remove('demo', 'ls', 'never-existed');
    expect(phone.store.pendingCount()).toBe(0);
  });

  it('keeps changes while offline and pushes them later', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    let online = true;
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time, () => online);
    await phone.store.pull();

    online = false;
    phone.store.set('demo', 'ls', 'note', 'written on the train');
    await phone.store.flush();
    expect(phone.store.status()).toMatchObject({ state: 'offline', pending: 1 });

    online = true;
    await phone.store.flush();
    expect(phone.store.status()).toMatchObject({ state: 'idle', pending: 0 });

    const laptop = await device(deps, 'laptop', time);
    await laptop.store.pull();
    expect(laptop.store.get('demo', 'ls', 'note')).toBe('written on the train');
  });

  it('propagates deletions', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time);
    const laptop = await device(deps, 'laptop', time);
    await phone.store.pull();
    phone.store.set('demo', 'ls', 'temp', 'x');
    await phone.store.flush();
    await laptop.store.pull();
    expect(laptop.store.keys('demo', 'ls')).toEqual(['temp']);

    time.advance(1000);
    phone.store.remove('demo', 'ls', 'temp');
    await phone.store.flush();
    await laptop.store.pull();
    expect(laptop.store.get('demo', 'ls', 'temp')).toBeNull();
    expect(laptop.store.keys('demo', 'ls')).toEqual([]);
  });

  it('survives a reload from IndexedDB with pending changes', async () => {
    const { store: server } = await tempStore();
    const time = clock(1_000_000);
    const deps = depsFor(server, time.now);
    const phone = await device(deps, 'phone', time, () => false);
    phone.store.set('demo', 'ls', 'draft', 'unsent');
    await phone.store.persisted();

    const reopened = await HubStore.open({
      api: inProcessApi(deps),
      persistence: phone.persistence,
      autoFlush: false,
      now: time.now,
    });
    expect(reopened.get('demo', 'ls', 'draft')).toBe('unsent');
    expect(reopened.pendingCount()).toBe(1);
  });
});
