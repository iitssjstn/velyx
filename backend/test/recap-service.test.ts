import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { episode, melody } from './segments-helpers.js';
import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import type { AudioReader } from '../src/services/segments/detector.js';
import { episodes, segmentFingerprints } from '../src/db/schema.js';

const INTRO = melody(30, 101);
const CREDITS = melody(40, 303);
const STORY = [melody(300, 11), melody(300, 12), melody(300, 13)];
const cut = (a: Float32Array, from: number, len: number) => a.slice(Math.round(from * SAMPLE_RATE), Math.round((from + len) * SAMPLE_RATE));

/**
 * Episode 1 has no recap. Episodes 2 and 3 open with clips of the episode before them (a recap of
 * 26 s), then a cold open, the intro, their story and the credits.
 */
function audioOf(file: string): Int16Array {
  const n = Number(/E0(\d)/.exec(path.basename(file))![1]) - 1;
  const recap = n === 0 ? [] : [cut(STORY[n - 1], 30, 6), cut(STORY[n - 1], 120, 7), cut(STORY[n - 1], 80, 5), cut(STORY[n - 1], 200, 8)];
  return episode([melody(2, 90 + n), ...recap, melody(20, 95 + n), INTRO, STORY[n], CREDITS], n + 1);
}

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.cleanup();
  env = null;
});

describe('recaps in the background detection', () => {
  it('finds the recap of later episodes, offers it to the player, and remembers what it read', async () => {
    const reads: string[] = [];
    const reader: AudioReader = async (file, start, duration) => {
      reads.push(`${path.basename(file)}@${Math.round(start)}+${Math.round(duration)}`);
      const pcm = audioOf(file);
      return pcm.slice(Math.round(start * SAMPLE_RATE), Math.round((start + duration) * SAMPLE_RATE));
    };
    env = await createTestEnv({ audioReader: reader, segmentRetryMs: 20, prober: async (file) => fakeProbe({ durationSec: audioOf(file).length / SAMPLE_RATE }) });
    const admin = await setupAdmin(env.app);
    for (const f of ['S01E01', 'S01E02', 'S01E03']) touch(path.join(env.mediaDir, 'tv', 'The Show', 'Season 01', `The.Show.${f}.mkv`));
    await addLibrary(env, admin, 'shows', 'tv');
    await env.ctx.segments.whenIdle();

    const id = (n: number) => env!.ctx.db.select().from(episodes).all().find((e) => e.episodeNumber === n)!.id;
    const seg = async (n: number) => (await env!.app.inject({ url: `/api/episodes/${id(n)}`, headers: { cookie: admin } })).json().segments;
    const first = await seg(1);
    expect(first.recap).toBeNull();
    expect(first.intro).toMatchObject({ confidence: expect.stringMatching(/high|medium/) });
    for (const n of [2, 3]) {
      const s = await seg(n);
      // Right after a short logo: skipped from the very start.
      expect(s.recap.start).toBe(0);
      expect(Math.abs(s.recap.end - 28)).toBeLessThan(1.5);
      expect(s.recap.confidence).toBe('high');
      // The recap ends before the cold open and the intro.
      expect(Math.abs(s.intro.start - 48)).toBeLessThan(1.5);
    }
    expect(env.ctx.segments.status().counts).toMatchObject({ recaps: 2, intros: 3 });

    // Episodes 1 and 2 were read whole (for the recaps after them); only the season's last episode
    // could keep that (a next episode may still come), so theirs is let go.
    expect(reads.filter((r) => /E0[12]\.mkv@0\+/.test(r)).length).toBeGreaterThanOrEqual(2);
    const kept = env.ctx.db.select().from(segmentFingerprints).all();
    expect(kept).toHaveLength(3);
    expect(kept.filter((r) => r.full && r.episodeId !== id(3))).toEqual([]);

    // Analysing again uses what was read before: episode 3 itself is not read again (only the
    // whole of the episodes before it, whose full fingerprints were let go).
    const before = reads.length;
    env.ctx.segments.reanalyze({ episodeId: id(3) });
    await env.ctx.segments.whenIdle();
    expect(reads.slice(before).filter((r) => r.startsWith('The.Show.S01E03'))).toEqual([]);
    expect((await seg(3)).recap.confidence).toBe('high');

    // An administrator's correction of the recap is kept.
    const put = await env.app.inject({ method: 'PUT', url: `/api/admin/segments/episodes/${id(2)}`, headers: { cookie: admin }, payload: { recap: { start: 0, end: 30 }, intro: { start: 48, end: 78 }, credits: null, postCredits: null } });
    expect(put.json().recap).toMatchObject({ start: 0, end: 30, source: 'manual' });
    const bad = await env.app.inject({ method: 'PUT', url: `/api/admin/segments/episodes/${id(2)}`, headers: { cookie: admin }, payload: { recap: { start: 0, end: 60 }, intro: { start: 48, end: 78 }, credits: null, postCredits: null } });
    expect(bad.statusCode).toBe(400);
    expect(env.ctx.db.select().from(episodes).where(eq(episodes.id, id(2))).get()).toBeTruthy();
  }, 120_000);
});
