import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { seasons, shows } from '../src/db/schema.js';

let env: TestEnv;
let admin: string;
let showId: number;
let eps: { id: number; seasonNumber: number; episodeNumber: number }[];

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  for (const f of ['S01E01.mkv', 'S01E02.mkv', 'S02E01.mkv', 'S02E02.mkv', 'S02E03.mkv', 'S00E01.mkv']) touch(path.join(env.mediaDir, 'tv', 'Reacher', f));
  await addLibrary(env, admin, 'shows', 'tv');
  showId = (await get('/api/shows')).items[0].id;
  const all = [];
  for (const n of [0, 1, 2]) all.push(...(await get(`/api/shows/${showId}/seasons/${n}`)).episodes);
  eps = all;
});
afterEach(() => env.cleanup());

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
const post = (url: string, payload: object, cookie = admin) => env.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const ep = (s: number, e: number) => eps.find((x) => x.seasonNumber === s && x.episodeNumber === e)!.id;

describe('series page', () => {
  it('lists seasons in order with specials last, and counts episodes', async () => {
    const show = await get(`/api/shows/${showId}`);
    expect(show.seasons.map((s: { seasonNumber: number; name: string; episodeCount: number }) => [s.seasonNumber, s.name, s.episodeCount])).toEqual([
      [1, 'Season 1', 2],
      [2, 'Season 2', 3],
      [0, 'Specials', 1],
    ]);
    expect(show).toMatchObject({ episodeCount: 6, watchedCount: 0, percentWatched: 0 });
  });

  it('shows how much is watched, per series and per season', async () => {
    await post('/api/progress/watched', { episodeId: ep(1, 1), watched: true });
    await post('/api/progress/watched', { episodeId: ep(1, 2), watched: true });
    await post('/api/progress/watched', { episodeId: ep(2, 1), watched: true });
    const show = await get(`/api/shows/${showId}`);
    expect(show).toMatchObject({ watchedCount: 3, percentWatched: 50 });
    expect(show.seasons.map((s: { percentWatched: number }) => s.percentWatched)).toEqual([100, 33, 0]);
    // Up next: the episode after the last one watched.
    expect(show.upNext).toMatchObject({ id: ep(2, 2), seasonNumber: 2, episodeNumber: 2, progress: null });
  });

  it('offers the episode in progress to resume, with its position and length', async () => {
    await post('/api/progress/watched', { episodeId: ep(1, 1), watched: true });
    await post('/api/progress', { episodeId: ep(2, 2), positionSec: 1934, durationSec: 2901 });
    const show = await get(`/api/shows/${showId}`);
    expect(show.upNext).toMatchObject({ id: ep(2, 2), progress: { positionSec: 1934, durationSec: 2901, completed: false }, durationSec: 3600 });
    const season = await get(`/api/shows/${showId}/seasons/2`);
    expect(season.episodes.map((e: { episodeNumber: number; progress: { positionSec: number } | null }) => [e.episodeNumber, e.progress?.positionSec ?? null])).toEqual([
      [1, null],
      [2, 1934],
      [3, null],
    ]);
  });

  it('marks a whole season watched and unwatched', async () => {
    const seasonId = (await get(`/api/shows/${showId}`)).seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 2).id;
    await post('/api/progress/watched', { seasonId, watched: true });
    let show = await get(`/api/shows/${showId}`);
    expect(show.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 2)).toMatchObject({ watchedCount: 3, percentWatched: 100 });
    await post('/api/progress/watched', { seasonId, watched: false });
    show = await get(`/api/shows/${showId}`);
    expect(show.watchedCount).toBe(0);
  });

  it('works without metadata and leaves out seasons without episodes', async () => {
    // No TMDB in tests: titles are empty, season names generated.
    const season = await get(`/api/shows/${showId}/seasons/1`);
    expect(season.episodes[0]).toMatchObject({ episodeNumber: 1, title: null, stillPath: null, overview: null });
    env.ctx.db.insert(seasons).values({ showId, seasonNumber: 5, name: 'Season 5' }).run();
    const show = await get(`/api/shows/${showId}`);
    expect(show.seasons.map((s: { seasonNumber: number }) => s.seasonNumber)).toEqual([1, 2, 0]);
  });

  it('shows each user their own progress and hides series outside their libraries', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    await post('/api/progress/watched', { episodeId: ep(1, 1), watched: true });
    expect((await get(`/api/shows/${showId}`, anna.cookie)).watchedCount).toBe(0);
    const other = env.ctx.db.select().from(shows).where(eq(shows.id, showId)).get()!;
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [] } });
    expect((await env.app.inject({ url: `/api/shows/${other.id}`, headers: { cookie: anna.cookie } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/shows/${other.id}/seasons/1`, headers: { cookie: anna.cookie } })).statusCode).toBe(404);
  });

  it('tells the player enough about the next episode for its card', async () => {
    const e = await get(`/api/episodes/${ep(1, 2)}`);
    expect(e.next).toEqual({ id: ep(2, 1), seasonNumber: 2, episodeNumber: 1, title: null, stillPath: null, overview: null, runtime: null, durationSec: 3600 });
    expect((await get(`/api/episodes/${ep(2, 3)}`)).next).toBeNull();
  });
});
