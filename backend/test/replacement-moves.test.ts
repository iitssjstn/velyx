import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, openDatabase } from '../src/db/client.js';
import { addLibrary, createTestEnv, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(() => env.cleanup());

const get = async (url: string) => (await env.app.inject({ url, headers: { cookie: admin } })).json();
const post = (url: string, payload: object) => env.app.inject({ method: 'POST', url, headers: { cookie: admin }, payload });
const movieByTitle = async (title: string) => (await get('/api/movies')).items.find((m: { title: string }) => m.title === title);

/** Watch history, a favorite and a watchlist entry for a movie. */
async function useMovie(id: number) {
  await post('/api/progress', { movieId: id, positionSec: 1200, durationSec: 6000 });
  await post('/api/favorites', { movieId: id });
}

function move(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

describe('a movie that moves to another library', () => {
  it('keeps its history when the old library is scanned first', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    // Something stays behind (a library that looks empty is never cleaned: the drive may be unmounted).
    touch(path.join(env.mediaDir, 'films', 'Heat (1995).mkv'), 'b');
    const films = await addLibrary(env, admin, 'movies', 'films');
    const uhd = await addLibrary(env, admin, 'movies', '4k');
    await useMovie((await movieByTitle('Dune')).id);
    move(path.join(films.path, 'Dune (2021).mkv'), path.join(uhd.path, 'Dune (2021) 2160p.mkv'));
    await rescan(env, films.id);
    expect(await movieByTitle('Dune')).toBeUndefined();
    await rescan(env, uhd.id);
    const dune = await get(`/api/movies/${(await movieByTitle('Dune')).id}`);
    expect(dune).toMatchObject({ libraryName: '4k', favorite: true, progress: { positionSec: 1200 } });
  });

  it('keeps its history when the new library is scanned first', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    touch(path.join(env.mediaDir, 'films', 'Heat (1995).mkv'), 'b');
    const films = await addLibrary(env, admin, 'movies', 'films');
    const uhd = await addLibrary(env, admin, 'movies', '4k');
    await useMovie((await movieByTitle('Dune')).id);
    move(path.join(films.path, 'Dune (2021).mkv'), path.join(uhd.path, 'Dune (2021) 2160p.mkv'));
    // The new copy is found before the old one is missed.
    await rescan(env, uhd.id);
    await rescan(env, films.id);
    const list = (await get('/api/movies')).items.filter((m: { title: string }) => m.title === 'Dune');
    expect(list).toHaveLength(1);
    expect(await get(`/api/movies/${list[0].id}`)).toMatchObject({ libraryName: '4k', favorite: true, progress: { positionSec: 1200 } });
  });

  it('does not give one title the history of another', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    touch(path.join(env.mediaDir, 'films', 'Heat (1995).mkv'), 'b');
    const films = await addLibrary(env, admin, 'movies', 'films');
    const uhd = await addLibrary(env, admin, 'movies', '4k');
    await useMovie((await movieByTitle('Dune')).id);
    fs.rmSync(path.join(films.path, 'Dune (2021).mkv'));
    move(path.join(films.path, 'Heat (1995).mkv'), path.join(uhd.path, 'Heat (1995).mkv'));
    await rescan(env, films.id);
    await rescan(env, uhd.id);
    expect(await get(`/api/movies/${(await movieByTitle('Heat')).id}`)).toMatchObject({ favorite: false, progress: null });
  });
});

describe('episodes that move to another library', () => {
  it('keep what was watched', async () => {
    touch(path.join(env.mediaDir, 'tv', 'Reacher', 'Reacher.S01E01.mkv'), 'a');
    touch(path.join(env.mediaDir, 'tv', 'Reacher', 'Reacher.S01E02.mkv'), 'b');
    touch(path.join(env.mediaDir, 'tv', 'Narcos', 'Narcos.S01E01.mkv'), 'c');
    const tv = await addLibrary(env, admin, 'shows', 'tv');
    const uhd = await addLibrary(env, admin, 'shows', 'tv-4k');
    const show = (await get('/api/shows')).items.find((x: { title: string }) => x.title === 'Reacher');
    const eps = (await get(`/api/shows/${show.id}/seasons/1`)).episodes;
    await post('/api/progress', { episodeId: eps[0].id, positionSec: 2950, durationSec: 3000 });
    await post('/api/progress', { episodeId: eps[1].id, positionSec: 900, durationSec: 3000 });
    await post('/api/favorites', { showId: show.id });
    move(path.join(tv.path, 'Reacher'), path.join(uhd.path, 'Reacher'));
    await rescan(env, uhd.id);
    await rescan(env, tv.id);
    const moved = (await get('/api/shows')).items.filter((x: { title: string }) => x.title === 'Reacher');
    expect(moved).toHaveLength(1);
    const detail = await get(`/api/shows/${moved[0].id}`);
    expect(detail).toMatchObject({ watchedCount: 1, favorite: true, upNext: { episodeNumber: 2, progress: { positionSec: 900 } } });
  });
});

describe('removing a library', () => {
  it('keeps the watch history for 90 days, so adding the folder again brings it back', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    const films = await addLibrary(env, admin, 'movies', 'films');
    await useMovie((await movieByTitle('Dune')).id);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/libraries/${films.id}`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect((await get('/api/movies')).total).toBe(0);
    // Added again, as a new library for the same folder.
    await addLibrary(env, admin, 'movies', 'films');
    expect(await get(`/api/movies/${(await movieByTitle('Dune')).id}`)).toMatchObject({ favorite: true, progress: { positionSec: 1200 } });
  });

  it('never deletes media files', async () => {
    touch(path.join(env.mediaDir, 'films', 'Dune (2021).mkv'), 'a');
    const films = await addLibrary(env, admin, 'movies', 'films');
    await env.app.inject({ method: 'DELETE', url: `/api/libraries/${films.id}`, headers: { cookie: admin } });
    expect(fs.existsSync(path.join(films.path, 'Dune (2021).mkv'))).toBe(true);
  });
});

describe('upgrading', () => {
  it('keeps what was set aside before, and lets it outlive its library', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-retired-'));
    try {
      const old = path.join(dir, 'old');
      fs.cpSync(migrationsFolder(), old, { recursive: true });
      const journalFile = path.join(old, 'meta', '_journal.json');
      const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      const at = journal.entries.findIndex((e: { tag: string }) => e.tag === '0018_retired_items_keep');
      expect(at).toBeGreaterThan(0);
      journal.entries.splice(at);
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      const file = path.join(dir, 'velyx.db');
      const before = openDatabase(file, { migrationsFolder: old });
      before.$client.prepare("INSERT INTO libraries (id, name, type, path) VALUES (7, 'Films', 'movies', '/media/films')").run();
      before.$client.prepare("INSERT INTO retired_items (kind, library_id, group_key, title, user_data) VALUES ('movie', 7, 'dune|2021', 'Dune', '{\"progress\":[],\"favorites\":[],\"watchlist\":[],\"collections\":[],\"dismissals\":[]}')").run();
      before.$client.close();
      const after = openDatabase(file, { backupDir: path.join(dir, 'backups') });
      expect(after.$client.prepare('SELECT library_id AS lib, title FROM retired_items').all()).toEqual([{ lib: 7, title: 'Dune' }]);
      after.$client.prepare('DELETE FROM libraries WHERE id = 7').run();
      expect(after.$client.prepare('SELECT library_id AS lib, title FROM retired_items').all()).toEqual([{ lib: null, title: 'Dune' }]);
      expect(after.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      after.$client.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
