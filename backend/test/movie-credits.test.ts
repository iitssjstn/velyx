import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { FRAME_H, FRAME_W, frameStats, type FrameStats } from '../src/services/segments/visual.js';
import { movieCredits, movieTailWindow } from '../src/services/segments/movie-credits.js';
import type { FrameReader } from '../src/services/segments/readers.js';
import type { ChapterReader } from '../src/services/segments/readers.js';
import { episodes, episodeSegments, movies, movieSegments } from '../src/db/schema.js';

const DURATION = 6000;
const CREDITS_AT = 5400;

/** A busy picture (a scene) or white lines of text on black (a credits card). */
function picture(kind: 'scene' | 'credits', seed: number): Uint8Array {
  const f = new Uint8Array(FRAME_W * FRAME_H);
  if (kind === 'scene') {
    let s = seed;
    for (let i = 0; i < f.length; i++) f[i] = 60 + Math.floor(((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 150);
    return f;
  }
  f.fill(4);
  for (let line = 0; line < 6; line++) {
    const y0 = 20 + line * 25 + (seed % 10);
    for (let y = y0; y < y0 + 4; y++) for (let x = 90; x < 230; x++) if (x % 7 < 3 && (x >> 4) % 3 !== 2) f[y * FRAME_W + x] = 220;
  }
  return f;
}

/** The movie's picture: scenes, then credits cards from `creditsAt` to the end (none when null). */
function movieReader(creditsAt: (file: string) => number | null, reads: string[] = []): FrameReader {
  return async (file, start, duration, mode) => {
    reads.push(`${path.basename(file)}:${mode}`);
    const at = creditsAt(file);
    const step = mode === 'keyframes' ? 2 : 0.5;
    const out: FrameStats[] = [];
    for (let t = start; t < Math.min(start + duration, DURATION); t += step) {
      out.push(frameStats(picture(at !== null && t >= at ? 'credits' : 'scene', Math.round(t * 2) + 1), t));
    }
    return out;
  };
}

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.cleanup();
  env = null;
});

async function setup(files: string[], readers: { frameReader?: FrameReader; chapterReader?: ChapterReader }) {
  env = await createTestEnv({
    // Detection is on in tests when an audio reader is given; movies never read audio.
    audioReader: async () => new Int16Array(0),
    segmentRetryMs: 20,
    prober: async () => fakeProbe({ durationSec: DURATION }),
    ...readers,
  });
  const admin = await setupAdmin(env.app);
  for (const f of files) touch(path.join(env.mediaDir, 'movies', f));
  await addLibrary(env, admin, 'movies', 'movies');
  await env.ctx.segments.whenIdle();
  const id = (title: string) => env!.ctx.db.select().from(movies).all().find((m) => m.title === title)!.id;
  const post = (payload: object) => env!.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload });
  const get = async (url: string) => (await env!.app.inject({ url, headers: { cookie: admin } })).json();
  return { env, admin, id, post, get };
}

describe('movie credits (pure)', () => {
  it('reads the last 20 minutes, or a quarter of a short movie', () => {
    expect(movieTailWindow(6000)).toEqual({ start: 4800, end: 6000 });
    expect(movieTailWindow(2400)).toEqual({ start: 1800, end: 2400 });
  });

  it('prefers chapters, falls back to the picture, and ignores credits too early in the movie', () => {
    const visual = { start: 5400.04, end: 6000, postCredits: null, confidence: 'high' as const, kind: 'card' as const };
    const chapters = { recap: null, intro: null, credits: { start: 5380, end: 5900 }, postCredits: { start: 5900, end: 6000 } };
    expect(movieCredits(chapters, visual, 6000)).toMatchObject({ start: 5380, source: 'chapters', confidence: 'high', postCredits: { start: 5900 } });
    expect(movieCredits(null, visual, 6000)).toMatchObject({ start: 5400, source: 'video', confidence: 'high' });
    // Text on black at 60 %: a title card or letter in the story, not the credits.
    expect(movieCredits(null, { ...visual, start: 3600 }, 6000)).toBeNull();
    expect(movieCredits(null, { ...visual, start: 5990 }, 6000)).toBeNull();
    expect(movieCredits(null, null, 6000)).toBeNull();
  });
});

describe('movie credits detection', () => {
  it('finds the credits of a movie in the picture of its closing part', async () => {
    const reads: string[] = [];
    const h = await setup(['Interstellar (2014).mkv', 'Arrival (2016).mkv'], {
      frameReader: movieReader((f) => (f.includes('Interstellar') ? CREDITS_AT : null), reads),
    });
    const row = h.env.ctx.db.select().from(movieSegments).where(eq(movieSegments.movieId, h.id('Interstellar'))).get()!;
    expect(row).toMatchObject({ status: 'analyzed', creditsSource: 'video', creditsConfidence: 'high' });
    expect(Math.abs(row.creditsStart! - CREDITS_AT)).toBeLessThanOrEqual(1);
    const none = h.env.ctx.db.select().from(movieSegments).where(eq(movieSegments.movieId, h.id('Arrival'))).get()!;
    expect(none).toMatchObject({ status: 'analyzed', creditsStart: null });
    // Only keyframes of the closing part, then a closer look where the credits start.
    expect(reads.filter((r) => r.startsWith('Interstellar'))).toEqual(['Interstellar (2014).mkv:keyframes', 'Interstellar (2014).mkv:dense']);
    expect(h.env.ctx.segments.status().movies).toMatchObject({ total: 2, analyzed: 2, credits: 1, pending: 0, errors: 0 });
    // Analysed once: a new scan does not read the movie again.
    reads.length = 0;
    h.env.ctx.segments.enqueuePending();
    await h.env.ctx.segments.whenIdle();
    expect(reads).toEqual([]);
  });

  it('takes the credits from chapter markers without reading the picture', async () => {
    const reads: string[] = [];
    const h = await setup(['Interstellar (2014).mkv'], {
      frameReader: movieReader(() => CREDITS_AT, reads),
      chapterReader: async () => [
        { start: 0, end: 5350, title: 'Chapter 1' },
        { start: 5350, end: DURATION, title: 'End Credits' },
      ],
    });
    expect(h.env.ctx.db.select().from(movieSegments).get()).toMatchObject({ creditsStart: 5350, creditsSource: 'chapters' });
    expect(reads).toEqual([]);
  });

  it('counts a movie as watched from where its credits start, otherwise at 95 %', async () => {
    const h = await setup(['Interstellar (2014).mkv', 'Arrival (2016).mkv'], {
      frameReader: movieReader((f) => (f.includes('Interstellar') ? CREDITS_AT : null)),
    });
    const interstellar = h.id('Interstellar');
    const arrival = h.id('Arrival');
    // Just before the credits: not yet.
    expect((await h.post({ movieId: interstellar, positionSec: 5300, durationSec: DURATION })).json()).toMatchObject({ completed: false });
    expect((await h.post({ movieId: interstellar, positionSec: 5410, durationSec: DURATION })).json()).toMatchObject({ completed: true, positionSec: 0 });
    // No credits known: 90 % is not enough any more, 95 % is.
    expect((await h.post({ movieId: arrival, positionSec: 5410, durationSec: DURATION })).json()).toMatchObject({ completed: false });
    expect((await h.post({ movieId: arrival, positionSec: 5700, durationSec: DURATION })).json()).toMatchObject({ completed: true });
  });
});

describe('episodes count as watched at their credits', () => {
  it('uses sure (or hand-set) credits, not a weak guess', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S01E01.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S01E02.mkv'));
    await addLibrary(env, admin, 'shows', 'tv');
    const [a, b] = env.ctx.db.select().from(episodes).all().sort((x, y) => x.episodeNumber - y.episodeNumber);
    const row = { status: 'analyzed' as const, method: 'automatic' as const, version: 1, creditsStart: 2700, creditsEnd: 3000 };
    env.ctx.db.insert(episodeSegments).values([{ ...row, episodeId: a.id, creditsConfidence: 'high' }, { ...row, episodeId: b.id, creditsConfidence: 'low' }]).run();
    const post = (episodeId: number, positionSec: number) => env!.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { episodeId, positionSec, durationSec: 3000 } });
    expect((await post(a.id, 2650)).json()).toMatchObject({ completed: false });
    expect((await post(a.id, 2710)).json()).toMatchObject({ completed: true });
    expect((await post(b.id, 2710)).json()).toMatchObject({ completed: false });
  });
});
