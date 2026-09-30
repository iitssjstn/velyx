import { describe, expect, it } from 'vitest';
import { addSeek, readSeekStep, SEEK_COMBINE_MS, skipAt, skipWindow, upNextStart, type EpisodeSegments } from './skip';

const seg = (over: Partial<EpisodeSegments> = {}): EpisodeSegments => ({ fileId: 5, intro: { start: 60, end: 120 }, credits: { start: 2500, end: 2590 }, postCredits: null, ...over });
const ask = { intro: 'ask', credits: 'ask' } as const;

describe('skipping', () => {
  it('offers to skip the intro and the credits while they play', () => {
    expect(skipAt(seg(), 5, 30, ask)).toBeNull();
    expect(skipAt(seg(), 5, 70, ask)).toEqual({ kind: 'intro', to: 120, toNext: false, mode: 'ask' });
    expect(skipAt(seg(), 5, 119.5, ask)).toBeNull();
    expect(skipAt(seg(), 5, 2510, ask)).toEqual({ kind: 'credits', to: 2590, toNext: true, mode: 'ask' });
  });

  it('never skips past a scene after the credits, or uses times of another version', () => {
    expect(skipAt(seg({ postCredits: { start: 2590, end: 2640 } }), 5, 2510, ask)).toEqual({ kind: 'credits', to: 2590, toNext: false, mode: 'ask' });
    expect(skipAt(seg(), 6, 70, ask)).toBeNull();
    expect(skipAt(seg(), 5, 70, { intro: 'never', credits: 'always' })).toBeNull();
    expect(skipAt(seg(), 5, 2510, { intro: 'never', credits: 'always' })?.mode).toBe('always');
  });

  it('offers the next episode when the credits start, else in the last seconds', () => {
    expect(upNextStart(seg(), 5, 2592, 10)).toBe(2500);
    expect(upNextStart(seg({ postCredits: { start: 2590, end: 2640 } }), 5, 2640, 10)).toBe(2628);
    expect(upNextStart(null, 5, 3000, 10)).toBe(2988);
    expect(upNextStart(seg(), 5, 0, 10)).toBeNull();
  });
});

describe('recaps, certainty and seeking (as on the website)', () => {
  it('offers to skip a recap, a moment after the detected start of a part', () => {
    const s = seg({ recap: { start: 2, end: 28, confidence: 'high' }, intro: { start: 60, end: 120, confidence: 'medium' } });
    expect(skipAt(s, 5, 10, ask)).toEqual({ kind: 'recap', to: 28, toNext: false, mode: 'ask' });
    expect(skipAt(s, 5, 61, ask)).toBeNull();
    expect(skipAt(s, 5, 62, ask)?.kind).toBe('intro');
    expect(skipWindow({ start: 10, end: 16, confidence: 'medium' })).toEqual({ from: 10, until: 15 });
    expect(skipAt(s, 5, 10, { recap: 'never', intro: 'ask', credits: 'ask' })).toBeNull();
  });

  it('adds up quick taps, within the video, and knows the steps', () => {
    const a = addSeek(null, 0, 100, 10, 500);
    expect(addSeek(a, 300, 101, 10, 500)).toMatchObject({ target: 120, total: 20 });
    expect(addSeek(a, SEEK_COMBINE_MS, 101, -10, 500)).toMatchObject({ target: 91, total: -10 });
    expect(readSeekStep(30)).toBe(30);
    expect(readSeekStep(7)).toBe(10);
    expect(readSeekStep(undefined)).toBe(10);
  });
});
