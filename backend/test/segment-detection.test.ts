import { describe, expect, it } from 'vitest';
import { fingerprint, FRAME_SEC } from '../src/services/segments/fingerprint.js';
import { detectSeason, headWindow, tailWindow, type EpisodeAudio } from '../src/services/segments/detect.js';
import { episode, melody, silence } from './segments-helpers.js';
import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';

/**
 * Builds a synthetic episode: [cold open][intro][story][credits][post-credits?] and cuts the head
 * and tail windows the detector would read.
 */
function makeEpisode(id: number, o: { coldOpen: number; intro: Float32Array | null; story: number; credits: Float32Array | null; postCredits?: number; trailingSilence?: number }): EpisodeAudio {
  const parts = [melody(o.coldOpen, id * 10 + 1)];
  if (o.intro) parts.push(o.intro);
  parts.push(melody(o.story, id * 10 + 2));
  if (o.credits) parts.push(o.credits);
  if (o.postCredits) parts.push(melody(o.postCredits, id * 10 + 3));
  if (o.trailingSilence) parts.push(silence(o.trailingSilence));
  const pcm = episode(parts, id);
  const duration = pcm.length / SAMPLE_RATE;
  const h = headWindow(duration);
  const t = tailWindow(duration);
  return {
    id,
    duration,
    head: fingerprint(pcm.subarray(0, Math.round(h.end * SAMPLE_RATE))),
    tail: fingerprint(pcm.subarray(Math.round(t.start * SAMPLE_RATE))),
    tailStart: t.start,
  };
}

const INTRO_S1 = melody(35, 1001);
const INTRO_S2 = melody(28, 2002);
const CREDITS = melody(45, 3003);
const empty = { intro: [], credits: [] };

describe('intro and credits detection', () => {
  it('finds the same intro at different positions in every episode of a season, with high confidence', () => {
    const eps = [
      makeEpisode(1, { coldOpen: 60, intro: INTRO_S1, story: 400, credits: CREDITS }),
      makeEpisode(2, { coldOpen: 95, intro: INTRO_S1, story: 420, credits: CREDITS }),
      makeEpisode(3, { coldOpen: 30, intro: INTRO_S1, story: 380, credits: CREDITS }),
    ];
    const r = detectSeason(eps, empty);
    for (const [id, start] of [[1, 60], [2, 95], [3, 30]] as const) {
      const d = r.get(id)!;
      expect(d.intro?.confidence).toBe('high');
      expect(d.intro!.start).toBeGreaterThan(start - 1.5);
      expect(d.intro!.start).toBeLessThan(start + 1.5);
      expect(d.intro!.end).toBeGreaterThan(start + 35 - 1.5);
      expect(d.intro!.end).toBeLessThan(start + 35 + 1.5);
      // Credits run to the end of the file (no scene afterwards).
      expect(d.credits?.confidence).toBe('high');
      expect(d.credits!.start).toBeCloseTo(eps[id - 1].duration - 45, -0.5);
      expect(d.credits!.end).toBeCloseTo(eps[id - 1].duration, 0);
      expect(d.postCredits).toBeNull();
    }
  });

  it('keeps a scene after the credits separate from the credits', () => {
    const eps = [
      makeEpisode(1, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: CREDITS, postCredits: 50 }),
      makeEpisode(2, { coldOpen: 40, intro: INTRO_S1, story: 320, credits: CREDITS }),
      makeEpisode(3, { coldOpen: 40, intro: INTRO_S1, story: 310, credits: CREDITS }),
    ];
    const d = detectSeason(eps, empty).get(1)!;
    const end = eps[0].duration;
    expect(d.credits!.end).toBeGreaterThan(end - 50 - 1.5);
    expect(d.credits!.end).toBeLessThan(end - 50 + 1.5);
    expect(d.postCredits).not.toBeNull();
    expect(d.postCredits!.start).toBeCloseTo(d.credits!.end, 5);
    expect(d.postCredits!.end).toBeCloseTo(end, 0);
  });

  it('treats silence after the credits as part of the credits, not as a scene', () => {
    const eps = [
      makeEpisode(1, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: CREDITS, trailingSilence: 30 }),
      makeEpisode(2, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: CREDITS }),
    ];
    const d = detectSeason(eps, empty).get(1)!;
    expect(d.postCredits).toBeNull();
    expect(d.credits!.end).toBeCloseTo(eps[0].duration, 0);
  });

  it('does not apply one season intro to another season', () => {
    const s2 = [
      makeEpisode(11, { coldOpen: 50, intro: INTRO_S2, story: 400, credits: CREDITS }),
      makeEpisode(12, { coldOpen: 70, intro: INTRO_S2, story: 400, credits: CREDITS }),
    ];
    // Season 1's intro as a stored reference must not match season 2 episodes.
    const ref = makeEpisode(1, { coldOpen: 0, intro: INTRO_S1, story: 5, credits: null });
    const d = detectSeason(s2, { intro: [{ words: ref.head.words.slice(0, Math.round(35 / FRAME_SEC)) }], credits: [] }).get(11)!;
    expect(d.intro!.start).toBeGreaterThan(48.5);
    expect(d.intro!.start).toBeLessThan(51.5);
    expect(d.intro!.end - d.intro!.start).toBeGreaterThan(26);
    expect(d.intro!.end - d.intro!.start).toBeLessThan(30);
  });

  it('reports nothing for episodes without an intro or credits', () => {
    const eps = [
      makeEpisode(1, { coldOpen: 200, intro: null, story: 300, credits: null }),
      makeEpisode(2, { coldOpen: 200, intro: null, story: 300, credits: null }),
    ];
    const d = detectSeason(eps, empty).get(1)!;
    expect(d.intro).toBeNull();
    expect(d.credits).toBeNull();
    expect(d.postCredits).toBeNull();
  });

  it('recognises a new episode from a stored reference alone', () => {
    const first = makeEpisode(1, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: CREDITS });
    const introRef = { words: first.head.words.slice(Math.round(40 / FRAME_SEC), Math.round(75 / FRAME_SEC)) };
    const newcomer = makeEpisode(9, { coldOpen: 120, intro: INTRO_S1, story: 300, credits: CREDITS });
    const d = detectSeason([newcomer], { intro: [introRef], credits: [] }).get(9)!;
    expect(d.intro?.confidence).toBe('high');
    expect(d.intro!.start).toBeGreaterThan(118.5);
    expect(d.intro!.start).toBeLessThan(121.5);
    // Nothing to compare the credits with: not reported.
    expect(d.credits).toBeNull();
  });

  it('with only one other episode, a single match is medium or high but never overstated for noise', () => {
    const eps = [
      makeEpisode(1, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: null }),
      makeEpisode(2, { coldOpen: 90, intro: INTRO_S1, story: 300, credits: null }),
    ];
    const d = detectSeason(eps, empty).get(1)!;
    expect(['medium', 'high']).toContain(d.intro?.confidence);
  });
});

describe('diagnosis', () => {
  it('reports every pair at each strictness level plus the final result, as pasteable text', async () => {
    const { diagnoseSeason, formatDiagnosis } = await import('../src/services/segments/diagnose.js');
    const eps = [
      makeEpisode(1, { coldOpen: 40, intro: INTRO_S1, story: 300, credits: CREDITS }),
      makeEpisode(2, { coldOpen: 70, intro: INTRO_S1, story: 320, credits: CREDITS }),
    ];
    const files = eps.map((e, i) => ({ id: e.id, episodeNumber: i + 1, path: `/tv/Show/S01E0${i + 1}.mkv`, audio: 'eac3 6ch eng', audioTracks: 2, error: null }));
    const d = diagnoseSeason([...files, { id: 99, episodeNumber: 3, path: '/tv/Show/S01E03.mkv', audio: '? ?ch', audioTracks: 0, error: 'Invalid data found' }], eps);
    const e1 = d.episodes[0];
    expect(e1.pairs).toHaveLength(1);
    expect(e1.pairs[0].peer).toBe(2);
    expect(Math.abs(e1.pairs[0].intro[0]!.start - 40)).toBeLessThan(1.5);
    expect(e1.result?.intro).toMatch(/^(39\.\d|40(\.\d)?)–7[45](\.\d)? \(medium, audio\)$/);
    expect(d.episodes[2]).toMatchObject({ error: 'Invalid data found', pairs: [], result: null });
    const text = formatDiagnosis('Show', 1, d);
    expect(text).toContain('E01 S01E01.mkv');
    expect(text).toContain('audio eac3 6ch eng (+1 more)');
    expect(text).toContain('ERROR Invalid data found');
    expect(text).toMatch(/vs E02 {2}intro /);
  }, 30_000);
});
