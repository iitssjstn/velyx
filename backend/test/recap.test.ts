import { describe, expect, it } from 'vitest';
import { episode, melody } from './segments-helpers.js';
import { fingerprint, FRAME_SEC, matchFragments, SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import { detectRecap } from '../src/services/segments/recap.js';

const INTRO = melody(30, 101);
const CREDITS = melody(40, 303);
const cut = (a: Float32Array, from: number, len: number) => a.slice(Math.round(from * SAMPLE_RATE), Math.round((from + len) * SAMPLE_RATE));

// The episode before: cold open, intro, story, credits.
const story1 = melody(300, 11);
const previous = episode([melody(20, 10), INTRO, story1, CREDITS], 1);
const prevIntro = { start: 20, end: 50 };
const prevCredits = { start: 350, end: 390 };

describe('finding a recap ("previously on")', () => {
  it('finds short clips of an earlier episode, each at its own place', () => {
    const clips = [cut(story1, 40, 6), cut(story1, 150, 5), cut(story1, 90, 7)];
    const query = fingerprint(episode([melody(3, 77), ...clips, melody(20, 78)], 5));
    const found = matchFragments(query, fingerprint(previous));
    expect(found.length).toBe(3);
    // In the order they play, found where they came from (story starts at 50 s in the earlier episode).
    [90, 200, 140].forEach((from, i) => expect(Math.abs(found[i].refStart * FRAME_SEC - from)).toBeLessThan(1.5));
  });

  it('marks the clips before the intro as the recap, whatever their length', () => {
    for (const lengths of [[6, 5, 7, 4], [8, 9, 10, 6, 7, 5]]) {
      let at = 60;
      const clips = lengths.map((l) => {
        const c = cut(story1, at, l);
        at += 37;
        return c;
      });
      const recapLen = lengths.reduce((a, b) => a + b, 0);
      // A two-second logo, the recap, a new cold open, then the intro.
      const current = episode([melody(2, 90), ...clips, melody(25, 91), INTRO, melody(200, 92), CREDITS], 6);
      const introStart = 2 + recapLen + 25;
      const recap = detectRecap(fingerprint(current.slice(0, 360 * SAMPLE_RATE)), introStart, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }]);
      expect(recap).not.toBeNull();
      expect(Math.abs(recap!.start - 2)).toBeLessThan(1.5);
      expect(Math.abs(recap!.end - (2 + recapLen))).toBeLessThan(1.5);
      expect(recap!.confidence).toBe('high');
    }
  });

  it('finds nothing in a new cold open, and never takes the recurring intro or credits for a recap', () => {
    const fresh = episode([melody(60, 55), INTRO, melody(200, 56), CREDITS], 7);
    expect(detectRecap(fingerprint(fresh.slice(0, 360 * SAMPLE_RATE)), 60, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }])).toBeNull();
    // No intro found: the part looked at includes the intro, which also plays in the earlier episode.
    expect(detectRecap(fingerprint(fresh.slice(0, 360 * SAMPLE_RATE)), 120, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }])).toBeNull();
  });
});
