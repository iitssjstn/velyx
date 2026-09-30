import { describe, expect, it } from 'vitest';
import { addSeek, creditsPlaying, SEEK_COMBINE_MS, skipAt, skipWindow, upNextStart, type EpisodeSegments } from './player';
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

describe('creditsPlaying', () => {
  it('is true only while end credits with nothing after them play', () => {
    expect(creditsPlaying(seg, 7, 1299)).toBe(false);
    expect(creditsPlaying(seg, 7, 1300)).toBe(true);
    expect(creditsPlaying(seg, 7, 1379)).toBe(true);
    expect(creditsPlaying(seg, 7, 1380)).toBe(false);
    // A scene after the credits: the card waits for the real end.
    expect(creditsPlaying({ ...seg, credits: { start: 1300, end: 1350 }, postCredits: { start: 1350, end: 1380 } }, 7, 1320)).toBe(false);
    // Credits found for another file, or not at all.
    expect(creditsPlaying(seg, 8, 1320)).toBe(false);
    expect(creditsPlaying(null, 7, 1320)).toBe(false);
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

describe('skip buttons with the detection’s certainty', () => {
  const sure: EpisodeSegments = { fileId: 7, recap: { start: 2, end: 28, confidence: 'high' }, intro: { start: 92, end: 122, confidence: 'medium' }, credits: { start: 1300, end: 1380, confidence: 'high' }, postCredits: null, manual: false };

  it('appears a moment after the detected start (later when less sure) and stays until just before the end', () => {
    expect(skipWindow({ start: 92, end: 122, confidence: 'high' })).toEqual({ from: 93, until: 121 });
    expect(skipWindow({ start: 92, end: 122, confidence: 'medium' })).toEqual({ from: 94, until: 121 });
    // A short part: shown long enough to press it.
    expect(skipWindow({ start: 10, end: 16, confidence: 'medium' })).toEqual({ from: 10, until: 15 });
    expect(skipAt(sure, 7, 93, ask)).toBeNull();
    expect(skipAt(sure, 7, 94, ask)?.kind).toBe('intro');
  });

  it('offers to skip a recap, following the intro’s preference unless it has its own', () => {
    expect(skipAt(sure, 7, 10, ask)).toEqual({ kind: 'recap', to: 28, toNext: false, mode: 'ask' });
    expect(skipAt(sure, 7, 10, { intro: 'never', credits: 'ask' })).toBeNull();
    expect(skipAt(sure, 7, 10, { recap: 'always', intro: 'never', credits: 'ask' })?.mode).toBe('always');
    // Seeking back into it later: offered again.
    expect(skipAt(sure, 7, 5, ask)?.kind).toBe('recap');
  });
});

describe('seeking by several presses', () => {
  it('adds up quick presses from where the last one aimed, within the video', () => {
    const a = addSeek(null, 1000, 100, 10, 500);
    expect(a).toEqual({ target: 110, total: 10, at: 1000 });
    const b = addSeek(a, 1300, 101, 10, 500);
    expect(b).toMatchObject({ target: 120, total: 20 });
    const c = addSeek(b, 1500, 102, -30, 500);
    expect(c).toMatchObject({ target: 90, total: -10 });
    // After a pause: a new jump from where the video is.
    expect(addSeek(c, 1500 + SEEK_COMBINE_MS, 95, 10, 500)).toMatchObject({ target: 105, total: 10 });
    expect(addSeek(null, 0, 3, -10, 500).target).toBe(0);
    expect(addSeek(null, 0, 495, 30, 500).target).toBe(500);
  });
});
