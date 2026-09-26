import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mediaReplacements, movies, retiredItems } from '../src/db/schema.js';
import { releaseSource, RETIRED_KEEP_MS, snapshotLabel } from '../src/services/replacements.js';
import { addLibrary, createTestEnv, createUser, fakeProbe, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let viewer: { cookie: string };

/** Quality follows the file name, like a real release: 2160p files are 4K HEVC HDR. */
const prober = async (file: string) =>
  /2160p/.test(file)
    ? fakeProbe({ container: 'mkv', videoCodec: 'hevc', width: 3840, height: 2160, videoBitDepth: 10, videoRange: 'HDR10', audioCodec: 'eac3' })
    : fakeProbe({ container: 'mkv', videoCodec: 'h264', width: 1920, height: 1080 });

beforeEach(async () => {
  env = await createTestEnv({ prober });
  admin = await setupAdmin(env.app);
  viewer = await createUser(env.app, admin, 'viewer');
});
afterEach(async () => {
  await env.cleanup();
});

const get = async (url: string, cookie = admin) => (await env.app.inject({ url, headers: { cookie } })).json();
const post = (url: string, payload: object, cookie = admin) => env.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const movieDir = () => path.join(env.mediaDir, 'movies');

async function watchHeat(file: string) {
  touch(path.join(movieDir(), file), 'x'.repeat(1000));
  const lib = await addLibrary(env, admin, 'movies', 'movies');
  const heat = (await get('/api/movies', viewer.cookie)).items[0];
  await post('/api/progress', { movieId: heat.id, positionSec: 4000, durationSec: 10200 }, viewer.cookie);
  await post('/api/favorites', { movieId: heat.id }, viewer.cookie);
  await post('/api/watchlist', { movieId: heat.id }, viewer.cookie);
  const col = (await post('/api/collections', { name: 'Crime nights' })).json();
  await post(`/api/collections/${col.id}/items`, { movieId: heat.id });
  return { lib, heat, col };
}

async function expectUserDataOn(movieId: number, collectionId: number) {
  const detail = await get(`/api/movies/${movieId}`, viewer.cookie);
  expect(detail.progress).toMatchObject({ positionSec: 4000, completed: false });
  expect(detail.favorite).toBe(true);
  expect(detail.watchlist).toBe(true);
  const col = await get(`/api/collections/${collectionId}`);
  expect(col.items.map((i: { id: number }) => i.id)).toContain(movieId);
}

describe('media replacement', () => {
  it('keeps everything when Radarr swaps the file within one scan, and records the upgrade', async () => {
    const { lib, heat, col } = await watchHeat('Heat (1995) 1080p WEB-DL.mkv');
    fs.rmSync(path.join(movieDir(), 'Heat (1995) 1080p WEB-DL.mkv'));
    touch(path.join(movieDir(), 'Heat (1995) 2160p BluRay REMUX.mkv'), 'x'.repeat(5000));
    await rescan(env, lib.id);

    const list = (await get('/api/movies', viewer.cookie)).items;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(heat.id); // same movie, same links
    await expectUserDataOn(heat.id, col.id);

    const detail = await get(`/api/movies/${heat.id}`, viewer.cookie);
    expect(detail.replacements).toHaveLength(1);
    expect(detail.replacements[0].previous).toMatchObject({ name: 'Heat (1995) 1080p WEB-DL.mkv', width: 1920, videoCodec: 'h264', source: 'WEB' });
    expect(detail.replacements[0].current).toMatchObject({ name: 'Heat (1995) 2160p BluRay REMUX.mkv', width: 3840, videoCodec: 'hevc', videoRange: 'HDR10', source: 'Blu-ray Remux' });

    // Library health lists it under "Recently replaced".
    const health = await get('/api/admin/health');
    expect(health.categories.find((c: { key: string }) => c.key === 'replaced').count).toBe(1);
    const replaced = await get('/api/admin/health/replaced');
    expect(replaced.items[0]).toMatchObject({ title: 'Heat', href: `/movies/${heat.id}`, library: 'movies' });
    expect(replaced.items[0].reasons[0]).toMatch(/^Previous: 1080p · H\.264 · WEB · 1 MB — Heat \(1995\) 1080p WEB-DL\.mkv$/);
    expect(replaced.items[0].reasons[1]).toMatch(/^Current: 2160p · HEVC · HDR10 · Blu-ray Remux/);
  });

  it('brings back watch history when the old file was removed a scan before the new one arrived', async () => {
    const { lib, col } = await watchHeat('Heat (1995) 1080p WEB-DL.mkv');
    fs.rmSync(path.join(movieDir(), 'Heat (1995) 1080p WEB-DL.mkv'));
    touch(path.join(movieDir(), 'keep-library-non-empty (2001).mkv'));
    await rescan(env, lib.id);
    expect((await get('/api/movies', viewer.cookie)).items.map((m: { title: string }) => m.title)).not.toContain('Heat');
    expect(env.ctx.db.select().from(retiredItems).all()).toHaveLength(1);

    touch(path.join(movieDir(), 'Heat.1995.2160p.BluRay.x265.mkv'), 'x'.repeat(5000));
    await rescan(env, lib.id);
    const heat = (await get('/api/movies', viewer.cookie)).items.find((m: { title: string }) => m.title === 'Heat');
    await expectUserDataOn(heat.id, col.id);
    const detail = await get(`/api/movies/${heat.id}`, viewer.cookie);
    expect(detail.replacements[0]).toMatchObject({ previous: { source: 'WEB', height: 1080 }, current: { source: 'Blu-ray', height: 2160 } });
    // The retired record is used up.
    expect(env.ctx.db.select().from(retiredItems).all()).toHaveLength(0);
  });

  it('recognises a returning movie by its TMDB id even when the file name changed completely', async () => {
    const { lib, heat, col } = await watchHeat('Heat (1995).mkv');
    env.ctx.db.update(movies).set({ tmdbId: 949 }).where(eq(movies.id, heat.id)).run(); // as if matched with TMDB
    fs.rmSync(path.join(movieDir(), 'Heat (1995).mkv'));
    touch(path.join(movieDir(), 'placeholder (2001).mkv'));
    await rescan(env, lib.id);
    touch(path.join(movieDir(), 'Heat Directors Definitive Edition {tmdb-949} 2160p.mkv'), 'x'.repeat(5000));
    await rescan(env, lib.id);
    const back = (await get('/api/movies', viewer.cookie)).items.find((m: { title: string }) => m.title !== 'Placeholder');
    expect(back.id).not.toBe(heat.id);
    await expectUserDataOn(back.id, col.id);
  });

  it('keeps episode progress and show favorites when an episode is upgraded later', async () => {
    const show = path.join(env.mediaDir, 'tv', 'Severance');
    touch(path.join(show, 'Severance S01E01 720p HDTV.mkv'), 'x'.repeat(500));
    const lib = await addLibrary(env, admin, 'shows', 'tv');
    const s = (await get('/api/shows', viewer.cookie)).items[0];
    const ep = (await get(`/api/shows/${s.id}`, viewer.cookie)).upNext;
    await post('/api/progress', { episodeId: ep.id, positionSec: 1200, durationSec: 3300 }, viewer.cookie);
    await post('/api/favorites', { showId: s.id }, viewer.cookie);

    fs.rmSync(path.join(show, 'Severance S01E01 720p HDTV.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Other', 'Other S01E01.mkv'));
    await rescan(env, lib.id);
    expect((await get('/api/shows', viewer.cookie)).items.map((x: { title: string }) => x.title)).toEqual(['Other']);

    touch(path.join(show, 'Severance S01E01 2160p WEB-DL.mkv'), 'x'.repeat(5000));
    await rescan(env, lib.id);
    const back = (await get('/api/shows', viewer.cookie)).items.find((x: { title: string }) => x.title === 'Severance');
    expect(back.favorite).toBe(true);
    const detail = await get(`/api/shows/${back.id}`, viewer.cookie);
    expect(detail.upNext.progress).toMatchObject({ positionSec: 1200 });
    const replaced = env.ctx.db.select().from(mediaReplacements).all();
    expect(replaced).toHaveLength(1);
    expect(replaced[0].previous).toMatchObject({ source: 'HDTV', height: 1080 });
    expect(replaced[0].current).toMatchObject({ source: 'WEB', height: 2160 });
  });

  it('records a release replaced under the same file name', async () => {
    const { lib, heat } = await watchHeat('Heat (1995).mkv');
    touch(path.join(movieDir(), 'Heat (1995).mkv'), 'y'.repeat(9000));
    await rescan(env, lib.id);
    const detail = await get(`/api/movies/${heat.id}`, viewer.cookie);
    expect(detail.replacements).toHaveLength(1);
    expect(detail.replacements[0].previous.size).toBe(1000);
    expect(detail.replacements[0].current.size).toBe(9000);
    expect(detail.progress.positionSec).toBe(4000);
  });

  it('treats a drive that comes back with the same files as a return, not a replacement', async () => {
    const { lib, col } = await watchHeat('Heat (1995).mkv');
    fs.renameSync(path.join(movieDir(), 'Heat (1995).mkv'), path.join(env.dir, 'Heat (1995).mkv'));
    touch(path.join(movieDir(), 'other (2001).mkv'));
    await rescan(env, lib.id);
    fs.renameSync(path.join(env.dir, 'Heat (1995).mkv'), path.join(movieDir(), 'Heat (1995).mkv'));
    await rescan(env, lib.id);
    const heat = (await get('/api/movies', viewer.cookie)).items.find((m: { title: string }) => m.title === 'Heat');
    await expectUserDataOn(heat.id, col.id);
    expect((await get(`/api/movies/${heat.id}`, viewer.cookie)).replacements).toEqual([]);
  });

  it('forgets retired items after 90 days', async () => {
    const { lib } = await watchHeat('Heat (1995).mkv');
    fs.rmSync(path.join(movieDir(), 'Heat (1995).mkv'));
    touch(path.join(movieDir(), 'other (2001).mkv'));
    await rescan(env, lib.id);
    env.ctx.db.update(retiredItems).set({ retiredAt: Date.now() - RETIRED_KEEP_MS - 1000 }).run();
    await rescan(env, lib.id);
    expect(env.ctx.db.select().from(retiredItems).all()).toHaveLength(0);
  });

  it('never touches the media files themselves', async () => {
    const { lib } = await watchHeat('Heat (1995) 1080p WEB-DL.mkv');
    touch(path.join(movieDir(), 'Heat (1995) 2160p BluRay.mkv'), 'x'.repeat(5000));
    await rescan(env, lib.id);
    expect(fs.readdirSync(movieDir()).sort()).toEqual(['Heat (1995) 1080p WEB-DL.mkv', 'Heat (1995) 2160p BluRay.mkv']);
    expect(fs.statSync(path.join(movieDir(), 'Heat (1995) 1080p WEB-DL.mkv')).size).toBe(1000);
  });
});

describe('release details', () => {
  it('reads the release source from file names', () => {
    expect(releaseSource('Heat.1995.2160p.UHD.BluRay.REMUX.HDR.mkv')).toBe('Blu-ray Remux');
    expect(releaseSource('Heat.1995.1080p.BluRay.x264.mkv')).toBe('Blu-ray');
    expect(releaseSource('Heat.1995.1080p.AMZN.WEB-DL.DDP5.1.mkv')).toBe('WEB');
    expect(releaseSource('Heat 1995 WEBRip.mkv')).toBe('WEB');
    expect(releaseSource('Show.S01E01.HDTV.x264.mkv')).toBe('HDTV');
    expect(releaseSource('Heat.1995.DVDRip.avi')).toBe('DVD');
    expect(releaseSource('Heat (1995).mkv')).toBeNull();
    expect(snapshotLabel({ name: 'x', size: 18.2 * 1024 ** 3, width: 3840, height: 2160, videoCodec: 'hevc', videoRange: 'HDR10', audioCodec: 'truehd', audioChannels: 8, source: 'Blu-ray' })).toBe(
      '2160p · HEVC · HDR10 · Blu-ray · 18.2 GB',
    );
  });
});
