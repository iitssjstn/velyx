import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { createMockTmdb, type MockTmdb } from './tmdb-mock.js';
import { episodes, movies, shows } from '../src/db/schema.js';
import { fromTmdb, localized, mergeTranslations, uiLanguageOf } from '../src/services/localize.js';

let env: TestEnv;
let tmdb: MockTmdb;
afterEach(async () => env?.cleanup());

async function start() {
  tmdb = createMockTmdb();
  env = await createTestEnv({ fetchImpl: tmdb.fetch, tmdbKey: 'test-key' });
  const admin = await setupAdmin(env.app);
  const dutch = await createUser(env.app, admin, 'anna');
  expect((await env.app.inject({ method: 'PUT', url: '/api/account/language', headers: { cookie: dutch.cookie }, payload: { language: 'nl' } })).statusCode).toBe(200);
  return { admin, dutch: dutch.cookie };
}
const get = async (url: string, cookie: string) => (await env.app.inject({ url, headers: { cookie } })).json();

describe('metadata in the interface language', () => {
  it('shows descriptions in the viewer’s language and keeps what was stored', async () => {
    const { admin, dutch } = await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E01.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E02.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E03.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    await addLibrary(env, admin, 'shows', 'tv');

    // Movies: list and detail.
    const [enCard] = (await get('/api/movies', admin)).items;
    const [nlCard] = (await get('/api/movies', dutch)).items;
    expect(enCard.overview).toBe('Interstellar overview');
    expect(nlCard.overview).toBe('Een groep ontdekkingsreizigers reist door een wormgat.');
    expect((await get(`/api/movies/${nlCard.id}`, dutch)).tagline).toBe('De mensheid werd op aarde geboren.');
    expect((await get(`/api/movies/${nlCard.id}`, admin)).tagline).toBe('Tagline');
    // What was stored stays as it was.
    expect(env.ctx.db.select().from(movies).get()).toMatchObject({ overview: 'Interstellar overview', tagline: 'Tagline' });

    // Shows, seasons and episodes (the season was asked once more, in Dutch).
    const show = env.ctx.db.select().from(shows).get()!;
    expect((await get(`/api/shows/${show.id}`, dutch)).overview).toBe('Een scheikundeleraar begint een drugsimperium.');
    expect((await get(`/api/shows/${show.id}`, admin)).overview).toBe('A chemistry teacher...');
    expect(tmdb.calls.some((c) => c.includes('/tv/1396/season/1') && c.includes('language=nl-NL'))).toBe(true);
    const season = await get(`/api/shows/${show.id}/seasons/1`, dutch);
    expect(season.overview).toBe('Seizoen 1 beschrijving');
    expect(season.episodes.map((e: { title: string; overview: string }) => [e.title, e.overview])).toEqual([
      // "Aflevering 1" is TMDB's placeholder: the stored title is kept; an empty description too.
      ['Episode title 1x1', 'Nederlandse afleveringsbeschrijving'],
      ['Nederlandse titel 1x2', 'Nederlandse afleveringsbeschrijving'],
      ['Nederlandse titel 1x3', 'Episode overview'],
    ]);
    expect((await get(`/api/shows/${show.id}/seasons/1`, admin)).episodes[1].title).toBe('Episode title 1x2');
    const ep = env.ctx.db.select().from(episodes).all().find((e) => e.episodeNumber === 2)!;
    expect((await get(`/api/episodes/${ep.id}`, dutch)).title).toBe('Nederlandse titel 1x2');
  });

  it('looks up translations for items matched before (and nothing else)', async () => {
    const { admin, dutch } = await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    // As matched by an older version: no translations kept.
    env.ctx.db.update(movies).set({ translations: null }).run();
    expect((await get('/api/movies', dutch)).items[0].overview).toBe('Interstellar overview');
    expect(await env.ctx.metadata.backfillTranslations()).toBe(1);
    expect((await get('/api/movies', dutch)).items[0].overview).toBe('Een groep ontdekkingsreizigers reist door een wormgat.');
    expect(env.ctx.db.select().from(movies).get()).toMatchObject({ title: 'Interstellar', overview: 'Interstellar overview' });
    // Done once.
    expect(await env.ctx.metadata.backfillTranslations()).toBe(0);
    // TMDB away: stops, nothing lost.
    env.ctx.db.update(movies).set({ translations: null }).run();
    tmdb.offline = true;
    expect(await env.ctx.metadata.backfillTranslations()).toBe(0);
    expect(env.ctx.db.select().from(movies).get()?.translations).toBeNull();
  });
});

describe('translations', () => {
  it('picks the interface languages from TMDB, preferring the Netherlands and the US', () => {
    const t = fromTmdb({ translations: [{ iso_639_1: 'nl', iso_3166_1: 'BE', data: { overview: 'Vlaams' } }, { iso_639_1: 'nl', iso_3166_1: 'NL', data: { name: 'Naam', overview: 'Nederlands', tagline: '' } }, { iso_639_1: 'fr', data: { overview: 'Français' } }] });
    expect(t).toEqual({ nl: { title: 'Naam', overview: 'Nederlands' } });
    expect(fromTmdb(undefined)).toEqual({});
    expect(mergeTranslations({ nl: { title: 'Oud', overview: 'Oud' } }, { nl: { overview: 'Nieuw' } })).toEqual({ nl: { title: 'Oud', overview: 'Nieuw' } });
    expect(uiLanguageOf('nl-NL')).toBe('nl');
    expect(uiLanguageOf('de-DE')).toBeNull();
    const row = { title: 'Title', overview: 'Overview', tagline: null, translations: JSON.stringify({ nl: { overview: 'Beschrijving' } }) };
    expect(localized(row, 'nl')).toEqual({ title: 'Title', overview: 'Beschrijving', tagline: null });
    expect(localized(row, 'en')).toEqual({ title: 'Title', overview: 'Overview', tagline: null });
    expect(localized({ ...row, translations: 'not json' }, 'nl').overview).toBe('Overview');
  });
});
