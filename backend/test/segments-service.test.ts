import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';
import { episode, melody, shotFrame } from './segments-helpers.js';
import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import type { AudioReader } from '../src/services/segments/detector.js';
import type { FrameReader } from '../src/services/segments/readers.js';
import { episodes, episodeSegments, mediaFiles } from '../src/db/schema.js';
import { playbackSegments, saveManualSegments } from '../src/services/segments/store.js';

const INTRO_S1 = melody(30, 101);
const INTRO_S2 = melody(25, 202);
const CREDITS = melody(40, 303);

/** Episode layouts by file name: cold open, the season's intro, story, credits to the end. */
const LAYOUT: Record<string, { cold: number; intro: Float32Array; seed: number }> = {
  'S01E01.mkv': { cold: 20, intro: INTRO_S1, seed: 1 },
  'S01E02.mkv': { cold: 35, intro: INTRO_S1, seed: 2 },
  'S01E03.mkv': { cold: 10, intro: INTRO_S1, seed: 3 },
  'S02E01.mkv': { cold: 15, intro: INTRO_S2, seed: 4 },
  'S02E02.mkv': { cold: 40, intro: INTRO_S2, seed: 5 },
  'S02E03.mkv': { cold: 25, intro: INTRO_S2, seed: 6 },
  // A season of one episode, with the intro of season 1.
  'S03E01.mkv': { cold: 30, intro: INTRO_S1, seed: 7 },
};

const name = (file: string) => path.basename(file).replace('The.Show.', '');
const audio = new Map<string, Int16Array>();
function audioOf(file: string): Int16Array {
  const key = name(file);
  if (!audio.has(key)) {
    const l = LAYOUT[key];
    audio.set(key, episode([melody(l.cold, l.seed * 10), l.intro, melody(200 - l.cold, l.seed * 10 + 1), CREDITS], l.seed));
  }
  return audio.get(key)!;
}

interface Harness {
  env: TestEnv;
  admin: string;
  reads: string[];
  libraryId: number;
  /** Files whose audio cannot be read. */
  broken: Set<string>;
}

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.cleanup();
  env = null;
});

async function setup(files = Object.keys(LAYOUT).filter((f) => !f.startsWith('S03')), opts: { enabled?: boolean; machineBusy?: boolean; frameReader?: FrameReader } = {}): Promise<Harness> {
  const reads: string[] = [];
  const broken = new Set<string>();
  const reader: AudioReader = async (file, start, duration) => {
    reads.push(name(file));
    if (broken.has(name(file))) throw new Error('Invalid data found when processing input');
    const pcm = audioOf(file);
    return pcm.slice(Math.round(start * SAMPLE_RATE), Math.round((start + duration) * SAMPLE_RATE));
  };
  env = await createTestEnv({
    audioReader: reader,
    segmentRetryMs: 20,
    machineBusy: () => !!opts.machineBusy,
    prober: async (file) => fakeProbe({ durationSec: audioOf(file).length / SAMPLE_RATE }),
    frameReader: opts.frameReader,
  });
  if (opts.enabled === false) env.ctx.settings.update({ segmentDetection: false });
  const admin = await setupAdmin(env.app);
  const root = path.join(env.mediaDir, 'tv');
  for (const f of files) touch(path.join(root, 'The Show', `Season ${f.slice(1, 3)}`, `The.Show.${f}`));
  const lib = await addLibrary(env, admin, 'shows', 'tv');
  await env.ctx.segments.whenIdle();
  return { env, admin, reads, libraryId: lib.id, broken };
}

const episodeId = (e: TestEnv, s: number, n: number) => e.ctx.db.select().from(episodes).where(eq(episodes.seasonNumber, s)).all().find((x) => x.episodeNumber === n)!.id;

describe('intro and credits detection service', () => {
  it('analyses new episodes after a scan and gives the player each season’s own intro', async () => {
    const h = await setup();
    const status = h.env.ctx.segments.status();
    expect(status.counts).toMatchObject({ episodes: 6, analyzed: 6, intros: 6, credits: 6, pending: 0, errors: 0 });
    expect(status.state).toBe('idle');

    for (const [s, n, cold] of [[1, 1, 20], [1, 2, 35], [2, 2, 40]] as const) {
      const res = await h.env.app.inject({ method: 'GET', url: `/api/episodes/${episodeId(h.env, s, n)}`, headers: { cookie: h.admin } });
      const seg = res.json().segments;
      expect(Math.abs(seg.intro.start - cold)).toBeLessThan(1.5);
      expect(Math.abs(seg.intro.end - (cold + (s === 1 ? 30 : 25)))).toBeLessThan(1.5);
      // Nothing follows the credits: they run to the end and there is no post-credits scene.
      expect(seg.credits.end - seg.credits.start).toBeGreaterThan(38);
      expect(seg.postCredits).toBeNull();
      expect(seg.fileId).toBe(res.json().files[0].id);
    }
  }, 60_000);

  it('places the intro by the picture when the music starts under the last line of the scene before', async () => {
    // The intro music starts at `cold`; the intro's picture only 2 s later (and ends with the music).
    const reader: FrameReader = async (file, start, duration, mode) => {
      if (mode === 'keyframes') return [];
      const l = LAYOUT[name(file)];
      const out = [];
      for (let t = start + (l.seed % 2) * 0.2; t < start + duration; t += 0.5) {
        const seed = t < l.cold + 2 ? 100 + l.seed * 1000 + Math.floor(t) : t < l.cold + 30 ? 500 + Math.floor(t - l.cold) : 300 + l.seed * 1000 + Math.floor(t);
        out.push(shotFrame(seed, t));
      }
      return out;
    };
    const h = await setup(['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv'], { frameReader: reader });
    for (const [n, cold] of [[1, 20], [2, 35], [3, 10]] as const) {
      const seg = (await h.env.app.inject({ method: 'GET', url: `/api/episodes/${episodeId(h.env, 1, n)}`, headers: { cookie: h.admin } })).json().segments;
      // Within a frame or two (2 per second); from the audio alone it would be 2 s early.
      expect(Math.abs(seg.intro.start - (cold + 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(seg.intro.end - (cold + 30))).toBeLessThan(1.5);
    }
  }, 60_000);

  it('finds the intro of a season with a single episode by comparing with the season before', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv', 'S03E01.mkv']);
    const seg = (await h.env.app.inject({ method: 'GET', url: `/api/episodes/${episodeId(h.env, 3, 1)}`, headers: { cookie: h.admin } })).json().segments;
    expect(Math.abs(seg.intro.start - 30)).toBeLessThan(1.5);
    expect(Math.abs(seg.intro.end - 60)).toBeLessThan(1.5);
    expect(seg.credits.end - seg.credits.start).toBeGreaterThan(38);
  }, 60_000);

  it('never analyses the same episode twice, but does when its file changes', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv']);
    const before = h.reads.length;
    expect(before).toBeGreaterThan(0);
    expect(h.env.ctx.segments.enqueuePending()).toBe(0);
    await rescan(h.env, h.libraryId);
    await h.env.ctx.segments.whenIdle();
    expect(h.reads.length).toBe(before);

    // The same episode in a new file (another size): analysed again, with its neighbours as reference.
    const id = episodeId(h.env, 1, 2);
    h.env.ctx.db.update(mediaFiles).set({ size: 999 }).where(eq(mediaFiles.episodeId, id)).run();
    expect(h.env.ctx.segments.enqueuePending()).toBe(1);
    await h.env.ctx.segments.whenIdle();
    expect(h.reads.length).toBeGreaterThan(before);
    expect(h.env.ctx.db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, id)).get()!.fileSize).toBe(999);
  }, 60_000);

  it('keeps going (slower) while someone watches on a quiet machine', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv'], { enabled: false });
    const file = h.env.ctx.db.select().from(mediaFiles).get()!;
    h.env.ctx.streams.touch({ id: 1, username: 'viewer' }, file.id, 'direct', null, null, Date.now());
    h.env.ctx.settings.update({ segmentDetection: true });
    h.env.ctx.segments.enqueuePending();
    await h.env.ctx.segments.whenIdle();
    expect(h.env.ctx.segments.status().counts.analyzed).toBe(2);
  }, 60_000);

  it('waits while someone is watching on a busy machine and continues afterwards', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv'], { enabled: false, machineBusy: true });
    const file = h.env.ctx.db.select().from(mediaFiles).get()!;
    // A stream that stops counting as active after half a second.
    h.env.ctx.streams.touch({ id: 1, username: 'viewer' }, file.id, 'direct', null, null, Date.now() - 59_500);
    h.env.ctx.settings.update({ segmentDetection: true });
    h.env.ctx.segments.enqueuePending();
    await new Promise((r) => setTimeout(r, 100));
    expect(h.env.ctx.segments.status()).toMatchObject({ state: 'waiting', waitingFor: 'playback' });
    expect(h.reads).toHaveLength(0);
    await h.env.ctx.segments.whenIdle();
    expect(h.reads.length).toBeGreaterThan(0);
    expect(h.env.ctx.segments.status().counts.analyzed).toBe(2);
  }, 60_000);

  it('does nothing while switched off', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv'], { enabled: false });
    expect(h.reads).toHaveLength(0);
    expect(h.env.ctx.segments.status()).toMatchObject({ state: 'disabled', counts: { pending: 2 } });
  });

  it('records unreadable files as errors without retrying them on every scan', async () => {
    const reads: string[] = [];
    const h0 = { broken: new Set(['S01E03.mkv']) };
    env = await createTestEnv({
      audioReader: async (file, start, duration) => {
        reads.push(name(file));
        if (h0.broken.has(name(file))) throw new Error('Invalid data found when processing input');
        return audioOf(file).slice(Math.round(start * SAMPLE_RATE), Math.round((start + duration) * SAMPLE_RATE));
      },
      segmentRetryMs: 20,
      prober: async (file) => fakeProbe({ durationSec: audioOf(file).length / SAMPLE_RATE }),
    });
    const admin = await setupAdmin(env.app);
    for (const f of ['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv']) touch(path.join(env.mediaDir, 'tv', 'The Show', 'Season 01', `The.Show.${f}`));
    await addLibrary(env, admin, 'shows', 'tv');
    await env.ctx.segments.whenIdle();
    expect(env.ctx.segments.status().counts).toMatchObject({ episodes: 3, analyzed: 2, errors: 1, intros: 2 });
    const failed = env.ctx.db.select().from(episodeSegments).where(eq(episodeSegments.status, 'error')).all();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ episodeId: episodeId(env, 1, 3), error: 'Invalid data found when processing input' });
    const n = reads.length;
    expect(env.ctx.segments.enqueuePending()).toBe(0);
    await env.ctx.segments.whenIdle();
    expect(reads.length).toBe(n);
  }, 60_000);

  it('keeps a correction by hand made earlier over automatic results when analysing again', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv']);
    const id = episodeId(h.env, 1, 1);
    const file = h.env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, id)).get()!;
    saveManualSegments(h.env.ctx.db, id, file, { intro: { start: 12, end: 44 }, credits: null, postCredits: { start: 230, end: 240 } });
    expect(h.env.ctx.segments.reanalyze({ showId: h.env.ctx.db.select().from(episodes).get()!.showId })).toBe(2);
    await h.env.ctx.segments.whenIdle();
    expect(playbackSegments(h.env.ctx.db, id)).toMatchObject({ manual: true, intro: { start: 12, end: 44 }, credits: null, postCredits: { start: 230, end: 240 } });
  }, 60_000);

  it('never gives the player low-confidence results', async () => {
    const h = await setup(['S01E01.mkv', 'S01E02.mkv']);
    const id = episodeId(h.env, 1, 1);
    h.env.ctx.db.update(episodeSegments).set({ introConfidence: 'low', creditsConfidence: 'medium' }).where(eq(episodeSegments.episodeId, id)).run();
    const seg = playbackSegments(h.env.ctx.db, id)!;
    expect(seg.intro).toBeNull();
    expect(seg.credits).not.toBeNull();
    h.env.ctx.db.update(episodeSegments).set({ creditsConfidence: 'low' }).where(eq(episodeSegments.episodeId, id)).run();
    expect(playbackSegments(h.env.ctx.db, id)).toBeNull();
    expect(h.env.ctx.segments.status().counts.lowConfidence).toBe(1);
  }, 60_000);

  it('re-analyses weak results once the season gains episodes', async () => {
    // A single episode has nothing to compare with.
    const h = await setup(['S01E01.mkv']);
    const id = episodeId(h.env, 1, 1);
    expect(h.env.ctx.db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, id)).get()).toMatchObject({ status: 'analyzed', introStart: null });
    expect(playbackSegments(h.env.ctx.db, id)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    for (const f of ['S01E02.mkv', 'S01E03.mkv']) touch(path.join(h.env.mediaDir, 'tv', 'The Show', 'Season 01', `The.Show.${f}`));
    await rescan(h.env, h.libraryId);
    await h.env.ctx.segments.whenIdle();
    expect(Math.abs(playbackSegments(h.env.ctx.db, id)!.intro!.start - 20)).toBeLessThan(1.5);
  }, 60_000);

  it('has no admin pages for intros and credits any more (they are in the Control Center), and leaves short episodes out', async () => {
    const h = await setup(['S01E01.mkv'], { enabled: false });
    for (const [method, url] of [['GET', '/api/admin/segments'], ['GET', '/api/admin/segments/shows/1'], ['PUT', '/api/admin/segments/episodes/1'], ['DELETE', '/api/admin/segments/episodes/1'], ['POST', '/api/admin/segments/analyze']] as const) {
      expect((await h.env.app.inject({ method, url, headers: { cookie: h.admin }, payload: method === 'GET' || method === 'DELETE' ? undefined : {} })).statusCode).toBe(404);
    }
    // Episodes too short to analyse are left out of the counts instead of waiting forever.
    h.env.ctx.db.update(mediaFiles).set({ durationSec: 30 }).run();
    expect(h.env.ctx.segments.status().counts).toMatchObject({ episodes: 0, pending: 0 });
  });

  it('stores skip preferences per user', async () => {
    const h = await setup([], { enabled: false });
    const get = async () => (await h.env.app.inject({ method: 'GET', url: '/api/account/preferences', headers: { cookie: h.admin } })).json();
    expect(await get()).toMatchObject({ skipIntro: 'ask', skipCredits: 'ask' });
    const put = await h.env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: h.admin }, payload: { skipIntro: 'always', skipCredits: 'never' } });
    expect(put.statusCode).toBe(200);
    expect(await get()).toMatchObject({ skipIntro: 'always', skipCredits: 'never' });
    expect((await h.env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: h.admin }, payload: { skipIntro: 'sometimes' } })).statusCode).toBe(400);
    // Recaps have their own preference.
    await h.env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: h.admin }, payload: { skipRecap: 'always' } });
    expect(await get()).toMatchObject({ skipRecap: 'always', skipIntro: 'always' });
    expect((await h.env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie: h.admin }, payload: { skipRecap: 'maybe' } })).statusCode).toBe(400);
  });
});

