import { describe, expect, it } from 'vitest';
import { downloadLine, downloadPercent, type Download } from './download';
import { translator } from './i18n';

const d = (over: Partial<Download>): Download => ({ fraction: 0.5, size: 100, sizeLeft: 50, eta: null, status: 'downloading', items: 1, ...over });
const now = Date.parse('2026-10-28T12:00:00Z');

describe('the progress of a request being fetched', () => {
  it('rounds down, and only says 100% when nothing is left', () => {
    expect(downloadPercent(d({ fraction: 0.426 }))).toBe(42);
    expect(downloadPercent(d({ fraction: 0.999, sizeLeft: 1 }))).toBe(99);
    expect(downloadPercent(d({ fraction: 1, sizeLeft: 0 }))).toBe(100);
  });

  it('says what it does, how long it should still take and how many files, in English and Dutch', () => {
    const en = translator('en');
    const nl = translator('nl');
    expect(downloadLine(d({ fraction: 0.426, eta: now + 25 * 60_000 }), now, en)).toBe('Fetching 42% · ~25m left');
    expect(downloadLine(d({ fraction: 0.426, eta: now + 25 * 60_000 }), now, nl)).toBe('Ophalen 42% · nog ~25m');
    expect(downloadLine(d({ eta: now + 10_000 }), now, en)).toBe('Fetching 50% · almost done');
    expect(downloadLine(d({ status: 'queued', items: 3 }), now, nl)).toBe('Wacht op ophalen · 3 bestanden');
    expect(downloadLine(d({ status: 'paused', eta: now + 60 * 60_000 }), now, en)).toBe('Fetching paused');
    expect(downloadLine(d({ status: 'warning', fraction: 0.8 }), now, en)).toBe('Problem while fetching (80%)');
  });

  it('names the seasons of a show being fetched', () => {
    expect(downloadLine(d({ seasons: [2] }), now, translator('nl'))).toBe('Seizoen 2 · Ophalen 50%');
    expect(downloadLine(d({ seasons: [2, 3], items: 4 }), now, translator('en'))).toBe('Seasons 2, 3 · Fetching 50% · 4 files');
    // A movie, or an older server that does not say.
    expect(downloadLine(d({ seasons: [] }), now, translator('en'))).toBe('Fetching 50%');
  });
});
