import { describe, expect, it } from 'vitest';
import { skipAt, upNextStart, type EpisodeSegments } from './player';
import { parseClock } from './format';

const seg: EpisodeSegments = { fileId: 7, intro: { start: 60, end: 95 }, credits: { start: 1300, end: 1380 }, postCredits: null, manual: false };
const ask = { intro: 'ask', credits: 'ask' } as const;

describe('skipAt', () => {
  it('offers to skip the intro only while it plays', () => {
    expect(skipAt(seg, 7, 59, ask)).toBeNull();
    expect(skipAt(seg, 7, 60, ask)).toEqual({ kind: 'intro', to: 95, toNext: false, mode: 'ask' });
    expect(skipAt(seg, 7, 94.5, ask)).toBeNull(); // the last second: over by then
    expect(skipAt(seg, 7, 200, ask)).toBeNull();
  });

  it('skips credits to the next episode, or to a post-credits scene which is never skipped', () => {
    expect(skipAt(seg, 7, 1310, ask)).toMatchObject({ kind: 'credits', to: 1380, toNext: true });
    const withScene = { ...seg, credits: { start: 1300, end: 1350 }, postCredits: { start: 1350, end: 1380 } };
    expect(skipAt(withScene, 7, 1310, ask)).toMatchObject({ kind: 'credits', to: 1350, toNext: false });
    expect(skipAt(withScene, 7, 1360, ask)).toBeNull();
  });

  it('respects the preferences and ignores times measured on another version of the episode', () => {
    expect(skipAt(seg, 7, 70, { intro: 'never', credits: 'ask' })).toBeNull();
    expect(skipAt(seg, 7, 70, { intro: 'always', credits: 'ask' })?.mode).toBe('always');
    expect(skipAt(seg, 8, 70, ask)).toBeNull();
    expect(skipAt(null, 7, 70, ask)).toBeNull();
  });
});

describe('upNextStart', () => {
  it('shows "Up next" when the credits begin, unless a scene follows them', () => {
    expect(upNextStart(seg, 7, 1380, 10)).toBe(1300);
    expect(upNextStart({ ...seg, credits: { start: 1300, end: 1350 }, postCredits: { start: 1350, end: 1380 } }, 7, 1380, 10)).toBe(1368);
    expect(upNextStart(null, 7, 1380, 10)).toBe(1368);
    expect(upNextStart(seg, 8, 1380, 10)).toBe(1368);
    expect(upNextStart(seg, 7, 0, 10)).toBeNull();
  });
});

describe('parseClock', () => {
  it('reads times the way people type them', () => {
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock('0:01:05')).toBe(65);
    expect(parseClock(' 95 ')).toBe(95);
    expect(parseClock('1:02:03.5')).toBe(3723.5);
    for (const bad of ['', 'abc', '1:75', '1::2', '-3']) expect(parseClock(bad)).toBeNull();
  });
});
