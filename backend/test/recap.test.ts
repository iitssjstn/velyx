import { describe, expect, it } from 'vitest';
import { episode, melody } from './segments-helpers.js';
import { fingerprint, FRAME_SEC, matchFragments, SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import { detectRecap } from '../src/services/segments/recap.js';
import { detectSeason, headWindow, tailWindow, type EpisodeAudio } from '../src/services/segments/detect.js';
import { cutNear, FRAME_H, FRAME_W, frameStats, isTitleLeadIn } from '../src/services/segments/visual.js';
import { shotFrame } from './segments-helpers.js';

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
      // Right at the start of the episode: the logo is skipped with it.
      expect(recap!.start).toBe(0);
      expect(Math.abs(recap!.end - (2 + recapLen))).toBeLessThan(1.5);
      expect(recap!.confidence).toBe('high');
    }
  });

  it('finds a recap of quick cuts from episodes further back, and only snaps to 0 s near the start', () => {
    // Clips of two to three seconds, from the episode before and one three episodes back.
    const older = melody(300, 21);
    const olderEpisode = episode([melody(20, 20), INTRO, older, CREDITS], 2);
    const clips = [cut(story1, 30, 3), cut(older, 40, 2.5), cut(story1, 120, 3), cut(older, 200, 2.5), cut(story1, 210, 3), cut(older, 100, 3)];
    const recapLen = 17;
    const sources = [
      { full: fingerprint(previous), exclude: [prevIntro, prevCredits] },
      { full: fingerprint(olderEpisode), exclude: [prevIntro, prevCredits] },
    ];
    const atStart = episode([...clips, melody(40, 93), INTRO, melody(200, 94), CREDITS], 8);
    const recap = detectRecap(fingerprint(atStart.slice(0, 360 * SAMPLE_RATE)), recapLen + 40, sources);
    expect(recap).not.toBeNull();
    expect(recap!.start).toBe(0);
    expect(Math.abs(recap!.end - recapLen)).toBeLessThan(1.5);
    // After a long cold open the recap keeps its own start.
    const later = episode([melody(30, 95), ...clips, melody(20, 96), INTRO, melody(200, 97), CREDITS], 9);
    const r = detectRecap(fingerprint(later.slice(0, 360 * SAMPLE_RATE)), 30 + recapLen + 20, sources);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.start - 30)).toBeLessThan(1.5);
  });

  it('finds nothing in a new cold open, and never takes the recurring intro or credits for a recap', () => {
    const fresh = episode([melody(60, 55), INTRO, melody(200, 56), CREDITS], 7);
    expect(detectRecap(fingerprint(fresh.slice(0, 360 * SAMPLE_RATE)), 60, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }])).toBeNull();
    // No intro found: the part looked at includes the intro, which also plays in the earlier episode.
    expect(detectRecap(fingerprint(fresh.slice(0, 360 * SAMPLE_RATE)), 120, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }])).toBeNull();
  });

  it('finds clips that play under music or a voice-over', () => {
    // Music as loud as the clips themselves is laid over the whole recap.
    const bed = melody(30, 500);
    const clips = [cut(story1, 40, 6), cut(story1, 150, 5), cut(story1, 90, 7), cut(story1, 200, 6)];
    let at = 0;
    const mixed = clips.map((c) => {
      const m = c.map((v, i) => v + 1.4 * (bed[at + i] ?? 0));
      at += c.length;
      return m;
    });
    const current = episode([melody(2, 90), ...mixed, melody(40, 93), INTRO, melody(200, 94), CREDITS], 8);
    const recap = detectRecap(fingerprint(current.slice(0, 360 * SAMPLE_RATE)), 66, [{ full: fingerprint(previous), exclude: [prevIntro, prevCredits] }]);
    expect(recap).not.toBeNull();
    expect(recap!.start).toBe(0);
    // All four clips (26 s after a two-second logo), not only the two the strict search hears.
    expect(recap!.end).toBeGreaterThan(24);
    expect(recap!.end).toBeLessThan(29.5);
    expect(recap!.confidence).not.toBe('low');
  });
});

/** An episode with its whole fingerprint: [cold open][intro][story][credits]. */
function seasonEpisode(id: number, pcm: Int16Array): EpisodeAudio {
  const duration = pcm.length / SAMPLE_RATE;
  const h = headWindow(duration);
  const t = tailWindow(duration);
  return {
    id,
    duration,
    head: fingerprint(pcm.subarray(0, Math.round(h.end * SAMPLE_RATE))),
    tail: fingerprint(pcm.subarray(Math.round(t.start * SAMPLE_RATE))),
    tailStart: t.start,
    full: fingerprint(pcm),
  };
}

describe('where a recap may come from', () => {
  const stories = Array.from({ length: 7 }, (_, i) => melody(240, 600 + i));
  const plain = (n: number, recap: Float32Array[] = []) => episode([melody(2, 700 + n), ...recap, melody(20, 710 + n), INTRO, stories[n], CREDITS], 800 + n);

  it('finds clips from five episodes back', () => {
    // Episode 7 opens with clips of episode 2 only.
    const clips = [cut(stories[1], 30, 6), cut(stories[1], 120, 7), cut(stories[1], 80, 5), cut(stories[1], 200, 8)];
    const eps = stories.map((_, n) => seasonEpisode(n + 1, n === 6 ? plain(n, clips) : plain(n)));
    const found = detectSeason(eps, { intro: [], credits: [] }, new Set([7])).get(7)!;
    expect(found.recap).not.toBeNull();
    expect(found.recap!.start).toBe(0);
    expect(Math.abs(found.recap!.end - 28)).toBeLessThan(1.5);
  }, 60_000);

  it("finds a season premiere's recap of the previous season's finale", () => {
    // The season before ended with this story; the new season opens with clips of it.
    const finale = seasonEpisode(101, plain(0));
    const before = seasonEpisode(100, plain(1));
    const clips = [cut(stories[0], 30, 6), cut(stories[0], 120, 7), cut(stories[0], 80, 5), cut(stories[0], 200, 8)];
    const premiere = seasonEpisode(201, plain(2, clips));
    const second = seasonEpisode(202, plain(3));
    const season = [premiere, second];
    expect(detectSeason(season, { intro: [], credits: [] }, new Set([201])).get(201)!.recap).toBeNull();
    const found = detectSeason(season, { intro: [], credits: [] }, new Set([201]), new Map(), [], [finale, before]).get(201)!;
    expect(found.recap).not.toBeNull();
    expect(Math.abs(found.recap!.end - 28)).toBeLessThan(1.5);
    expect(found.recap!.confidence).toBe('high');
  }, 60_000);
});

describe('the picture around a recap', () => {
  const black = (t: number) => frameStats(new Uint8Array(FRAME_W * FRAME_H), t);
  const frames = (from: number, to: number, at: (t: number) => ReturnType<typeof black>) => Array.from({ length: Math.round((to - from) * 2) }, (_, i) => at(from + i / 2));

  it('puts an edge on the nearest cut, and leaves it where there is none', () => {
    // Shots change every 3 s: cuts at 39.25 and 42.25 (between the frames around them).
    const shots = frames(36, 48, (t) => shotFrame(Math.floor((t - 0.5) / 3), t));
    expect(cutNear(shots, 41.4, 3)).toBe(42.3);
    expect(cutNear(shots, 40.2, 3)).toBe(39.3);
    const still = frames(36, 48, (t) => shotFrame(7, t));
    expect(cutNear(still, 41.4, 3)).toBeNull();
  });

  it('takes black or a title card before the first clip as part of the recap, not a scene', () => {
    const card = frames(0, 16, (t) => (t < 15 ? black(t) : shotFrame(3, t)));
    expect(isTitleLeadIn(card, 15)).toBe(true);
    const scene = frames(0, 16, (t) => shotFrame(Math.floor(t / 4), t));
    expect(isTitleLeadIn(scene, 15)).toBe(false);
  });
});
