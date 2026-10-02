import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { episodes, movies, shows } from '../src/db/schema.js';
import { FRESH_FOR_MS, FreshMetadata } from '../src/services/fresh-metadata.js';
import type { FetchLike } from '../src/services/tmdb.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { createMockTmdb, type MockTmdb } from './tmdb-mock.js';

let env: TestEnv;
let tmdb: MockTmdb;
let admin: string;
afterEach(async () => env?.cleanup());

/** TMDB answers only once `release()` is called (while `held`). */
let held = false;
const waiting: Array<() => void> = [];
const release = () => {
  held = false;
  for (const go of waiting.splice(0)) go();
};

async function start() {
  tmdb = createMockTmdb();
  const fetchImpl: FetchLike = async (input, init) => {
    if (held) await new Promise<void>((go) => waiting.push(go));
    return tmdb.fetch(input, init);
  };
  env = await createTestEnv({ fetchImpl, tmdbKey: 'test-key' });
  admin = await setupAdmin(env.app);
}

const refresh = (type: 'movies' | 'shows', id: number | string, cookie: string | null = admin) =>
  env.app.inject({ method: 'POST', url: `/api/${type}/${id}/refresh`, headers: cookie ? { cookie } : {} });
const tmdbCalls = (p: string) => tmdb.calls.filter((c) => c.split('?')[0] === `/3${p}`).length;
/** Makes the title's last refresh older than the hour. */
const age = (table: typeof movies | typeof shows, id: number) =>
  env.ctx.db.update(table).set({ metadataUpdatedAt: Date.now() - FRESH_FOR_MS - 1000 }).where(eq(table.id, id)).run();

async function movie() {
  touch(path.join(env.mediaDir, 'films', 'Interstellar (2014).mkv'));
  const lib = await addLibrary(env, admin, 'movies', 'films');
  const row = env.ctx.db.select().from(movies).get()!;
  return { lib, id: row.id };
}

describe('fresh metadata when a title is opened', () => {
  it('fetches a movie anew after an hour; within the hour everyone gets the stored metadata', async () => {
    await start();
    const { id } = await movie();
    const before = tmdbCalls('/movie/157336');

    // Just matched: fresh, TMDB is not asked.
    expect((await refresh('movies', id)).json()).toEqual({ status: 'fresh' });
    expect(tmdbCalls('/movie/157336')).toBe(before);

    // Over an hour old, and changed at TMDB in the meantime (here: the stored title is outdated).
    env.ctx.db.update(movies).set({ title: 'Old title', overview: 'Old overview' }).where(eq(movies.id, id)).run();
    age(movies, id);
    expect((await refresh('movies', id)).json()).toEqual({ status: 'refreshed', id });
    expect(tmdbCalls('/movie/157336')).toBe(before + 1);
    const page = (await env.app.inject({ url: `/api/movies/${id}`, headers: { cookie: admin } })).json();
    expect(page).toMatchObject({ title: 'Interstellar', overview: 'Interstellar overview' });

    // Someone else opening it within the hour: the same stored metadata, no new request.
    const user = await createUser(env.app, admin, 'viewer');
    expect((await refresh('movies', id, user.cookie)).json()).toEqual({ status: 'fresh' });
    expect(tmdbCalls('/movie/157336')).toBe(before + 1);
  });

  it('shares one refresh between people opening the same title at the same moment', async () => {
    await start();
    const { id } = await movie();
    const before = tmdbCalls('/movie/157336');
    age(movies, id);
    held = true;
    const both = Promise.all([refresh('movies', id), refresh('movies', id)]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const answers = (await both).map((r) => r.json());
    expect(answers).toEqual([{ status: 'refreshed', id }, { status: 'refreshed', id }]);
    expect(tmdbCalls('/movie/157336')).toBe(before + 1);
  });

  it('refreshes a show with its seasons and episodes on the server', async () => {
    await start();
    touch(path.join(env.mediaDir, 'series', 'Breaking Bad', 'Season 1', 'Breaking.Bad.S01E01.mkv'));
    await addLibrary(env, admin, 'shows', 'series');
    const show = env.ctx.db.select().from(shows).get()!;
    expect(show.matchStatus).toBe('matched');
    env.ctx.db.update(episodes).set({ title: 'Old episode title' }).where(eq(episodes.showId, show.id)).run();
    age(shows, show.id);
    const showCalls = tmdbCalls('/tv/1396');
    const seasonCalls = tmdbCalls('/tv/1396/season/1');

    expect((await refresh('shows', show.id)).json()).toEqual({ status: 'refreshed', id: show.id });
    expect(tmdbCalls('/tv/1396')).toBe(showCalls + 1);
    expect(tmdbCalls('/tv/1396/season/1')).toBeGreaterThan(seasonCalls);
    expect(env.ctx.db.select().from(episodes).where(eq(episodes.showId, show.id)).get()!.title).toBe('Episode title 1x1');
    expect((await refresh('shows', show.id)).json()).toEqual({ status: 'fresh' });
  });

  it('keeps the stored metadata when TMDB cannot be reached, and does not ask again on every click', async () => {
    await start();
    const { id } = await movie();
    age(movies, id);
    tmdb.offline = true;
    const before = tmdb.calls.length;
    expect((await refresh('movies', id)).json()).toEqual({ status: 'skipped' });
    const asked = tmdb.calls.length;
    expect(asked).toBeGreaterThan(before);
    expect(env.ctx.db.select().from(movies).where(eq(movies.id, id)).get()!.title).toBe('Interstellar');
    expect((await refresh('movies', id)).json()).toEqual({ status: 'skipped' });
    expect(tmdb.calls.length).toBe(asked);
  });

  it('answers "pending" while TMDB is slow, and the refresh goes on', async () => {
    await start();
    const { id } = await movie();
    age(movies, id);
    const fresh = new FreshMetadata(env.ctx.db, env.ctx.metadata, { waitMs: 10 });
    const before = tmdbCalls('/movie/157336');
    held = true;
    expect(await fresh.refresh('movie', id)).toEqual({ status: 'pending' });
    expect(await fresh.refresh('movie', id)).toEqual({ status: 'pending' });
    release();
    // Asking again joins the refresh that is still running; once done, the title is fresh.
    const joined = await fresh.refresh('movie', id);
    expect(['refreshed', 'fresh']).toContain(joined.status);
    await new Promise((r) => setTimeout(r, 50));
    expect(await fresh.refresh('movie', id)).toEqual({ status: 'fresh' });
    expect(tmdbCalls('/movie/157336')).toBe(before + 1);
  });

  it('skips titles without a match, and is only for who may see the title', async () => {
    await start();
    const { lib, id } = await movie();
    const unmatched = env.ctx.db.insert(movies).values({ libraryId: lib.id, groupKey: 'x', title: 'X', sortTitle: 'x', parsedTitle: 'X' }).returning().get();
    expect((await refresh('movies', unmatched.id)).json()).toEqual({ status: 'skipped' });

    expect((await refresh('movies', id, null)).statusCode).toBe(401);
    expect((await refresh('movies', 'abc')).statusCode).toBe(400);
    expect((await refresh('movies', 999_999)).statusCode).toBe(404);
    const showLib = await addLibrary(env, admin, 'shows', 'series');
    const kid = await createUser(env.app, admin, 'kid');
    expect((await env.app.inject({ method: 'PUT', url: `/api/users/${kid.id}`, headers: { cookie: admin }, payload: { libraryIds: [showLib.id] } })).statusCode).toBe(200);
    expect((await refresh('movies', id, kid.cookie)).statusCode).toBe(404);
  });

  it('does nothing without a TMDB key', async () => {
    env = await createTestEnv({ tmdbKey: '' });
    admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'films', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'films');
    const row = env.ctx.db.select().from(movies).get()!;
    expect((await refresh('movies', row.id)).json()).toEqual({ status: 'skipped' });
  });
});
