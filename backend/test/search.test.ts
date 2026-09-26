import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { episodes, libraries, movies, seasons, shows } from '../src/db/schema.js';
import { ftsQuery } from '../src/services/search.js';
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
