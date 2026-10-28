import { describe, expect, it } from 'vitest';
import { downloadPercent, downloadTimeLeft, type Download } from './download';

const d = (over: Partial<Download>): Download => ({ fraction: 0.5, size: 100, sizeLeft: 50, eta: null, status: 'downloading', items: 1, ...over });

describe('the progress of a request being fetched', () => {
  it('rounds down, and only says 100% when nothing is left', () => {
    expect(downloadPercent(d({ fraction: 0.426 }))).toBe(42);
    expect(downloadPercent(d({ fraction: 0.999, sizeLeft: 1 }))).toBe(99);
    expect(downloadPercent(d({ fraction: 1, sizeLeft: 0 }))).toBe(100);
    expect(downloadPercent(d({ fraction: 7 }))).toBe(99);
  });

  it('says how long it should still take, if known and not paused', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(downloadTimeLeft(d({ eta: now + 25 * 60_000 }), now)).toBe('25m');
    expect(downloadTimeLeft(d({ eta: now + 20_000 }), now)).toBe('');
    expect(downloadTimeLeft(d({ eta: now - 60_000 }), now)).toBe('');
    expect(downloadTimeLeft(d({ eta: null }), now)).toBeNull();
    expect(downloadTimeLeft(d({ eta: now + 25 * 60_000, status: 'paused' }), now)).toBeNull();
  });
});
