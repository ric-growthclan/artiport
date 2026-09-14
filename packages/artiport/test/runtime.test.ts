// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { installClaude } from '../src/runtime/claude-use';
import { createStorageProxy, installLocalStorage } from '../src/runtime/storage-proxy';
import { createWindowStorage } from '../src/runtime/window-storage';
import { memoryBridge } from '../src/shared/bridge';

describe('localStorage proxy', () => {
  it('behaves like Storage for methods, properties and enumeration', () => {
    const storage = createStorageProxy(memoryBridge(), 'demo') as Storage & Record<string, unknown>;
    storage.setItem('a', '1');
    storage.b = 2;
    expect(storage.getItem('a')).toBe('1');
    expect(storage.b).toBe('2');
    expect(storage.length).toBe(2);
    expect(Object.keys(storage)).toEqual(['a', 'b']);
    expect('a' in storage).toBe(true);
    expect('missing' in storage).toBe(false);
    expect(storage.key(1)).toBe('b');
    expect(storage.key(5)).toBeNull();
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.missing).toBeUndefined();
    delete storage.a;
    expect(storage.getItem('a')).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('keeps sections apart', () => {
    const bridge = memoryBridge();
    createStorageProxy(bridge, 'one').setItem('k', 'first');
    expect(createStorageProxy(bridge, 'two').getItem('k')).toBeNull();
  });

  it('replaces window.localStorage', () => {
    const bridge = memoryBridge();
    expect(installLocalStorage(bridge, 'demo')).toBe(true);
    window.localStorage.setItem('from-artifact', 'yes');
    expect(bridge.getItem('demo', 'ls', 'from-artifact')).toBe('yes');
  });
});

describe('window.storage', () => {
  it('matches the claude.ai chat artifact API', async () => {
    const storage = createWindowStorage(memoryBridge(), 'diet');
    await expect(storage.get('plan')).rejects.toThrow('Key not found');
    expect(await storage.set('plan', '{"meals":3}')).toEqual({ key: 'plan', value: '{"meals":3}', shared: false });
    expect(await storage.get('plan')).toEqual({ key: 'plan', value: '{"meals":3}', shared: false });
    await storage.set('plan:week', 'w1');
    expect((await storage.list('plan')).keys).toEqual(['plan', 'plan:week']);
    expect(await storage.delete('plan')).toEqual({ key: 'plan', deleted: true, shared: false });
    expect((await storage.list()).keys).toEqual(['plan:week']);
  });

  it('keeps shared and personal data apart', async () => {
    const storage = createWindowStorage(memoryBridge(), 'diet');
    await storage.set('k', 'personal');
    await storage.set('k', 'shared', true);
    expect((await storage.get('k')).value).toBe('personal');
    expect((await storage.get('k', true)).value).toBe('shared');
  });
});

describe('window.claude', () => {
  it('serves downloads and user, and null for everything else', async () => {
    installClaude();
    const claude = (window as unknown as { claude: { use(name: string): Promise<unknown> } }).claude;
    expect(await claude.use('downloads')).not.toBeNull();
    expect(await claude.use('user')).not.toBeNull();
    expect(await claude.use('db')).toBeNull();
    expect(await claude.use('sample')).toBeNull();
  });
});
