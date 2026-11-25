import { describe, expect, it } from 'vitest';
import {
  canSaveService,
  changedFields,
  directStep,
  encoderNote,
  filterItems,
  hasChanges,
  isTimeOfDay,
  normalizeTime,
  parseNetworks,
  prefetchLine,
  publicPort,
  relayLine,
  serviceBody,
  streamLimit,
  transcodingStatus,
  wholeNumberIn,
  type TranscodingState,
} from './adminSettings';

describe('changedFields', () => {
  it('returns only what differs', () => {
    const saved = { a: 1, b: true, c: 'x' };
    expect(changedFields(saved, { a: 1, b: false, c: 'y' })).toEqual({ b: false, c: 'y' });
    expect(hasChanges(changedFields(saved, { ...saved }))).toBe(false);
  });
});

describe('time of day', () => {
  it('accepts HH:MM only', () => {
    expect(isTimeOfDay('02:00')).toBe(true);
    expect(isTimeOfDay('23:59')).toBe(true);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('2:00')).toBe(false);
    expect(isTimeOfDay('02:60')).toBe(false);
  });
  it('normalizes what a phone keyboard gives', () => {
    expect(normalizeTime('2:5')).toBe('02:05');
    expect(normalizeTime('0230')).toBe('02:30');
    expect(normalizeTime('23.00')).toBe('23:00');
    expect(normalizeTime('abc')).toBe('abc');
  });
});

describe('numbers', () => {
  it('wholeNumberIn', () => {
    expect(wholeNumberIn('120', 30, 3600)).toBe(120);
    expect(wholeNumberIn('29', 30, 3600)).toBeNull();
    expect(wholeNumberIn('3601', 30, 3600)).toBeNull();
    expect(wholeNumberIn('12.5', 30, 3600)).toBeNull();
    expect(wholeNumberIn('', 30, 3600)).toBeNull();
  });
  it('streamLimit: empty is no limit', () => {
    expect(streamLimit('')).toEqual({ ok: true, value: null });
    expect(streamLimit('3')).toEqual({ ok: true, value: 3 });
    expect(streamLimit('0')).toEqual({ ok: false });
    expect(streamLimit('101')).toEqual({ ok: false });
  });
  it('publicPort', () => {
    expect(publicPort('32400')).toBe(32400);
    expect(publicPort('80')).toBeNull();
    expect(publicPort('70000')).toBeNull();
  });
});

describe('transcoding', () => {
  const base: TranscodingState = { settings: { enabled: true, encoder: 'auto', maxStreams: null }, support: { software: true, vaapi: null, nvenc: false, noKeyframes: ['nvenc'], checkedAt: 1 }, inUse: 'software', active: 2 };
  it('status', () => {
    expect(transcodingStatus(base)).toEqual({ key: 'onWith', encoder: 'software', active: 2 });
    expect(transcodingStatus({ ...base, inUse: null }).key).toBe('noEncoder');
    expect(transcodingStatus({ ...base, settings: { ...base.settings, enabled: false } }).key).toBe('off');
  });
  it('encoder notes', () => {
    expect(encoderNote(base.support, 'software')).toBe('works');
    expect(encoderNote(base.support, 'nvenc')).toBe('noKeyframes');
    expect(encoderNote(base.support, 'vaapi')).toBe('notFound');
    expect(encoderNote({ ...base.support!, vaapi: '/dev/dri/renderD128' }, 'vaapi')).toBe('works');
    expect(encoderNote(null, 'software')).toBeNull();
  });
});

describe('services', () => {
  it('sends the key only when typed', () => {
    expect(serviceBody(' http://nas:5055 ', '  ')).toEqual({ url: 'http://nas:5055' });
    expect(serviceBody('http://nas:5055', ' abc ')).toEqual({ url: 'http://nas:5055', apiKey: 'abc' });
  });
  it('needs an address and a key unless saved', () => {
    expect(canSaveService('', 'k', true)).toBe(false);
    expect(canSaveService('http://x', '', false)).toBe(false);
    expect(canSaveService('http://x', '', true)).toBe(true);
    expect(canSaveService('http://x', 'k', false)).toBe(true);
  });
  it('filters titles', () => {
    const items = [{ id: 1, title: 'Lupin', year: 2021, monitored: true, status: null }, { id: 2, title: 'Dune', year: 2021, monitored: true, status: null }];
    expect(filterItems(items, 'lu').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, ' ')).toHaveLength(2);
  });
});

describe('cloud', () => {
  it('parses home networks', () => {
    expect(parseNetworks('100.64.0.0/10\n 10.8.0.0/24, ')).toEqual(['100.64.0.0/10', '10.8.0.0/24']);
    expect(parseNetworks('')).toEqual([]);
  });
  it('names the missing direct step', () => {
    const a = { configured: true, hostname: 'h', port: 1, dnsReady: true, tlsReady: true, portOpen: true, url: null };
    expect(directStep(a)).toBeNull();
    expect(directStep({ ...a, portOpen: false })).toBe('port');
    expect(directStep({ ...a, tlsReady: false, portOpen: false })).toBe('tls');
    expect(directStep({ ...a, dnsReady: false })).toBe('dns');
    expect(directStep({ ...a, configured: false })).toBe('notConfigured');
  });
  it('relay line', () => {
    const r = { enabled: true, url: null, connected: false, error: null, allowed: true };
    expect(relayLine(r)).toBe('connecting');
    expect(relayLine({ ...r, connected: true })).toBe('connected');
    expect(relayLine({ ...r, error: 'closed' })).toBe('closed');
  });
});

describe('prefetchLine', () => {
  const s = (pending: number, waitingFor: 'window' | null = null, on = true) => ({ subtitlePrefetch: on, subtitlePrefetchStatus: { enabled: on, pending, running: false, waitingFor } });
  it('picks the line', () => {
    expect(prefetchLine(s(0, null, false))).toBeNull();
    expect(prefetchLine(s(0))?.key).toBe('done');
    expect(prefetchLine(s(1))?.key).toBe('one');
    expect(prefetchLine(s(5, 'window'))).toEqual({ key: 'other', count: 5, waitsForWindow: true });
  });
});
