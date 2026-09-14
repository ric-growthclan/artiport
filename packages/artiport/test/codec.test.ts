import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, isEntry, parseDataFile, serializeDataFile } from '../src/shared/codec';
import { compareStamps, mergeIncoming } from '../src/shared/merge';
import type { DataFile, Entry } from '../src/shared/types';

const file = (entries: Record<string, Entry>): DataFile => ({ format: 1, entries });

describe('value codec', () => {
  it('stores exact JSON parsed and anything else raw', () => {
    expect(encodeValue('{"b":1,"a":[true,null]}')).toEqual({ j: { b: 1, a: [true, null] } });
    expect(encodeValue('hello')).toEqual({ v: 'hello' });
    expect(encodeValue('1.0')).toEqual({ v: '1.0' });
    expect(encodeValue('{ "spaced": 1 }')).toEqual({ v: '{ "spaced": 1 }' });
    expect(encodeValue('null')).toEqual({ j: null });
  });

  it('keeps integer-like keys raw because JSON.parse would reorder them', () => {
    expect(encodeValue('{"b":1,"1":2}')).toEqual({ v: '{"b":1,"1":2}' });
  });

  it('round-trips through a serialized file byte for byte', () => {
    const originals = ['{"z":1,"a":{"y":2,"b":3}}', 'plain text', '[3,2,1]', '""', 'null'];
    const entries: Record<string, Entry> = {};
    originals.forEach((value, i) => {
      entries[`ls:k${i}`] = { ...encodeValue(value), t: [i + 1, 'dev'] };
    });
    const reread = parseDataFile(serializeDataFile(file(entries)));
    originals.forEach((value, i) => expect(decodeValue(reread.entries[`ls:k${i}`])).toBe(value));
  });

  it('serializes deterministically with sorted keys', () => {
    const a = serializeDataFile(file({ 'ls:b': { v: '2', t: [2, 'x'] }, 'ls:a': { v: '1', t: [1, 'x'] } }));
    const b = serializeDataFile(file({ 'ls:a': { v: '1', t: [1, 'x'] }, 'ls:b': { v: '2', t: [2, 'x'] } }));
    expect(a).toBe(b);
    expect(a.indexOf('ls:a')).toBeLessThan(a.indexOf('ls:b'));
  });

  it('decodes tombstones as missing and validates entries', () => {
    expect(decodeValue({ del: true, t: [1, 'x'] })).toBeNull();
    expect(isEntry({ v: 'x', t: [1, 'dev'] })).toBe(true);
    expect(isEntry({ j: null, t: [1, 'dev'] })).toBe(true);
    expect(isEntry({ v: 'x', t: [1] })).toBe(false);
    expect(isEntry({ t: [1, 'dev'] })).toBe(false);
    expect(isEntry({ v: 'x', t: [-1, 'dev'] })).toBe(false);
  });
});

describe('merge', () => {
  it('orders stamps by time, then device', () => {
    expect(compareStamps([1, 'b'], [2, 'a'])).toBe(-1);
    expect(compareStamps([2, 'b'], [2, 'a'])).toBe(1);
    expect(compareStamps([2, 'a'], [2, 'a'])).toBe(0);
  });

  it('keeps the newest value per key and reports whether anything changed', () => {
    const base = file({ 'ls:x': { v: 'server', t: [100, 'a'] } });
    const older = mergeIncoming(base, { 'ls:x': { v: 'stale', t: [50, 'b'] } }, 1000);
    expect(older.changed).toBe(false);
    expect(decodeValue(older.file.entries['ls:x'])).toBe('server');

    const newer = mergeIncoming(base, { 'ls:x': { v: 'fresh', t: [200, 'b'] }, 'ls:y': { del: true, t: [10, 'b'] } }, 1000);
    expect(newer.changed).toBe(true);
    expect(decodeValue(newer.file.entries['ls:x'])).toBe('fresh');
    expect(newer.file.entries['ls:y']).toEqual({ del: true, t: [10, 'b'] });
  });

  it('is idempotent, so retried syncs are harmless', () => {
    const incoming = { 'ls:x': { v: 'once', t: [5, 'a'] } as Entry };
    const first = mergeIncoming(file({}), incoming, 1000);
    const second = mergeIncoming(first.file, incoming, 1000);
    expect(second.changed).toBe(false);
  });

  it('clamps stamps from the future to server time', () => {
    const merged = mergeIncoming(file({}), { 'ls:x': { v: 'fast clock', t: [9_999_999, 'a'] } }, 1000);
    expect(merged.file.entries['ls:x'].t).toEqual([1000, 'a']);
  });
});
