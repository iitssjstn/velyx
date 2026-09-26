import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { episodes, libraries, movies, seasons, shows } from '../src/db/schema.js';
import { ftsQuery, parseEpisodeCode } from '../src/services/search.js';
import { createUser } from './helpers.js';
import { createTestEnv, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let libId: number;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  libId = env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
});
afterEach(async () => {
  await env.cleanup();
});

const addMovie = (title: string, originalTitle: string | null = null) =>
  env.ctx.db.insert(movies).values({ libraryId: libId, groupKey: title, title, sortTitle: title.toLowerCase(), parsedTitle: title, originalTitle }).returning().get();
const search = async (q: string) => (await env.app.inject({ url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie: admin } })).json();

describe('full-text search', () => {
  it('finds hyphenated titles from separate words', async () => {
    addMovie('Spider-Man');
    addMovie('Spider-Man: Homecoming');
    addMovie('Spider-Man: No Way Home');
    addMovie('The Amazing Spider-Man');
    addMovie('Batman');
    const r = await search('spider man');
    const titles = r.movies.map((m: { title: string }) => m.title);
    expect(titles).toHaveLength(4);
    // Titles starting with the query first.
    expect(titles.slice(0, 3).sort()).toEqual(['Spider-Man', 'Spider-Man: Homecoming', 'Spider-Man: No Way Home']);
    expect((await search('no way')).movies.map((m: { title: string }) => m.title)).toEqual(['Spider-Man: No Way Home']);
    expect((await search('spid')).movies).toHaveLength(4);
  });

  it('ignores accents and case and matches original titles', async () => {
    addMovie('Amélie', 'Le Fabuleux Destin d’Amélie Poulain');
    expect((await search('AMELIE')).movies).toHaveLength(1);
    expect((await search('fabuleux destin')).movies).toHaveLength(1);
  });

  it('keeps the index in sync with renames and deletions', async () => {
    const m = addMovie('Working Title');
    env.ctx.db.update(movies).set({ title: 'Final Name', parsedTitle: 'final.name.2020' }).where(eq(movies.id, m.id)).run();
    expect((await search('working')).movies).toHaveLength(0);
    expect((await search('final')).movies).toHaveLength(1);
    // The name parsed from the file stays searchable after a metadata match changes the title.
    env.ctx.db.update(movies).set({ title: 'Something Else' }).where(eq(movies.id, m.id)).run();
    expect((await search('final')).movies).toHaveLength(1);
    env.ctx.db.delete(movies).where(eq(movies.id, m.id)).run();
    expect((await search('final')).movies).toHaveLength(0);
  });

  it('indexes shows and episodes', async () => {
    const tvLib = env.ctx.db.insert(libraries).values({ name: 'tv', type: 'shows', path: '/media/tv' }).returning().get().id;
    const show = env.ctx.db.insert(shows).values({ libraryId: tvLib, groupKey: 'bb', title: 'Breaking Bad', sortTitle: 'breaking bad', parsedTitle: 'Breaking Bad' }).returning().get();
    const season = env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: 5 }).returning().get();
    const ep = env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: season.id, seasonNumber: 5, episodeNumber: 14, title: null }).returning().get();
    expect((await search('ozymandias')).episodes).toHaveLength(0);
    env.ctx.db.update(episodes).set({ title: 'Ozymandias' }).where(eq(episodes.id, ep.id)).run();
    const r = await search('ozym');
    expect(r.episodes).toMatchObject([{ showTitle: 'Breaking Bad', seasonNumber: 5, episodeNumber: 14 }]);
    expect((await search('breaking')).shows).toHaveLength(1);
  });

  it('builds safe FTS queries', () => {
    expect(ftsQuery('Spider-Man: No Way Home')).toBe('"spider"* AND "man"* AND "no"* AND "way"* AND "home"*');
    expect(ftsQuery('"OR" NOT * ')).toBe('"or"* AND "not"*');
    expect(ftsQuery('%%% ---')).toBeNull();
  });

  it('stays fast with thousands of titles', async () => {
    env.ctx.db.transaction((tx) => {
      for (let i = 0; i < 5000; i++) tx.insert(movies).values({ libraryId: libId, groupKey: `g${i}`, title: `Film number ${i}`, sortTitle: `film ${i}`, parsedTitle: 'x' }).run();
    });
    addMovie('Needle In A Haystack');
    const t = performance.now();
    const r = await search('needle hay');
    expect(r.movies).toHaveLength(1);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('searching by episode code', () => {
  function addShow(title: string, eps: [number, number, string | null][], library = libId) {
    const show = env.ctx.db.insert(shows).values({ libraryId: library, groupKey: title, title, sortTitle: title.toLowerCase(), parsedTitle: title }).returning().get();
    for (const [s, e, t] of eps) {
      const season = env.ctx.db.select().from(seasons).where(eq(seasons.showId, show.id)).all().find((x) => x.seasonNumber === s) ?? env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: s }).returning().get();
      env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: season.id, seasonNumber: s, episodeNumber: e, title: t }).run();
    }
    return show;
  }
  const codes = (r: { episodes: { showTitle: string; seasonNumber: number; episodeNumber: number }[] }) => r.episodes.map((e) => `${e.showTitle} ${e.seasonNumber}x${e.episodeNumber}`);

  it('reads the code in the ways people type it', () => {
    expect(parseEpisodeCode('Reacher S02E04')).toEqual({ season: 2, episode: 4, rest: 'Reacher' });
    expect(parseEpisodeCode('reacher s2e4')).toEqual({ season: 2, episode: 4, rest: 'reacher' });
    expect(parseEpisodeCode('reacher 2x04')).toEqual({ season: 2, episode: 4, rest: 'reacher' });
    expect(parseEpisodeCode('reacher season 2 episode 4')).toEqual({ season: 2, episode: 4, rest: 'reacher' });
    expect(parseEpisodeCode('reacher s02')).toEqual({ season: 2, episode: null, rest: 'reacher' });
    expect(parseEpisodeCode('S01E01')).toEqual({ season: 1, episode: 1, rest: '' });
    expect(parseEpisodeCode('reacher')).toBeNull();
    expect(parseEpisodeCode('1917')).toBeNull();
  });

  it('puts the named episode first, in the shows the rest of the query finds', async () => {
    addShow('Reacher', [[1, 1, 'Welcome to Margrave'], [2, 1, 'ATM'], [2, 4, 'A Night at the Motel']]);
    addShow('Narcos', [[2, 4, 'Sin Salida']]);
    expect(codes(await search('Reacher S02E04'))).toEqual(['Reacher 2x4']);
    expect(codes(await search('reacher 2x04'))).toEqual(['Reacher 2x4']);
    // A whole season.
    expect(codes(await search('reacher s02'))).toEqual(['Reacher 2x1', 'Reacher 2x4']);
    // Only a code: every show that has it.
    expect(codes(await search('s02e04'))).toEqual(['Narcos 2x4', 'Reacher 2x4']);
    // A code that does not exist, and a show that does not exist.
    expect(codes(await search('reacher s09e01'))).toEqual([]);
    expect(codes(await search('dexter s02e04'))).toEqual([]);
    // Episode titles are still found by words.
    expect(codes(await search('night at the motel'))).toEqual(['Reacher 2x4']);
  });

  it('only finds episodes in libraries the user may see', async () => {
    const other = env.ctx.db.insert(libraries).values({ name: 'tv', type: 'shows', path: '/media/tv' }).returning().get().id;
    addShow('Reacher', [[2, 4, 'A Night at the Motel']], other);
    const anna = await createUser(env.app, admin, 'anna');
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [libId] } });
    const r = (await env.app.inject({ url: '/api/search?q=s02e04', headers: { cookie: anna.cookie } })).json();
    expect(r.episodes).toEqual([]);
    expect(codes(await search('s02e04'))).toEqual(['Reacher 2x4']);
  });
});
