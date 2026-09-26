import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { createMockTmdb } from './tmdb-mock.js';

let env: TestEnv;
let admin: string;

async function start() {
  const tmdb = createMockTmdb();
  env = await createTestEnv({ fetchImpl: tmdb.fetch, tmdbKey: 'test-key' });
  admin = await setupAdmin(env.app);
}
afterEach(async () => {
  await env.cleanup();
});

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
async function send(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = admin) {
  return env.app.inject({ method, url, headers: { cookie }, payload });
}
const movieId = async (title: string) => (await get('/api/movies')).items.find((m: { title: string }) => m.title === title).id as number;

describe('TMDB collections', () => {
  it('groups movies from the same TMDB collection, in release order', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'The Matrix Reloaded (2003).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');

    const list = await get('/api/collections');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'auto', name: 'The Matrix Collection', itemCount: 2, posterPath: '/matrix-coll.jpg' });

    const detail = await get(`/api/collections/${list[0].id}`);
    expect(detail.items.map((i: { title: string }) => i.title)).toEqual(['The Matrix', 'The Matrix Reloaded']);

    const matrix = await get(`/api/movies/${await movieId('The Matrix')}`);
    expect(matrix.collections).toEqual([{ id: list[0].id, name: 'The Matrix Collection', kind: 'auto' }]);
    expect((await get(`/api/movies/${await movieId('Interstellar')}`)).collections).toEqual([]);
  });

  it('hides a TMDB collection with only one movie in the library', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    expect(await get('/api/collections')).toEqual([]);
    expect((await get(`/api/movies/${await movieId('The Matrix')}`)).collections).toEqual([]);
  });

  it('only counts movies from libraries the user can see', async () => {
    await start();
    touch(path.join(env.mediaDir, 'a', 'The Matrix (1999).mkv'));
    touch(path.join(env.mediaDir, 'b', 'The Matrix Reloaded (2003).mkv'));
    const a = await addLibrary(env, admin, 'movies', 'a');
    await addLibrary(env, admin, 'movies', 'b');
    const coll = (await get('/api/collections'))[0];
    const user = await createUser(env.app, admin, 'viewer');
    await send('PUT', `/api/users/${user.id}`, { libraryIds: [a.id] });
    expect(await get('/api/collections', user.cookie)).toEqual([]);
    expect((await env.app.inject({ url: `/api/collections/${coll.id}`, headers: { cookie: user.cookie } })).statusCode).toBe(404);
  });

  it('cannot be edited by hand', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'The Matrix Reloaded (2003).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const coll = (await get('/api/collections'))[0];
    expect((await send('PUT', `/api/collections/${coll.id}`, { name: 'Mine' })).statusCode).toBe(400);
    expect((await send('DELETE', `/api/collections/${coll.id}`)).statusCode).toBe(400);
  });
});

describe('manual collections', () => {
  it('lets admins create, fill, reorder by addition, rename and delete collections', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S01E01.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    await addLibrary(env, admin, 'shows', 'tv');
    const showId = (await get('/api/shows')).items[0].id;

    const created = (await send('POST', '/api/collections', { name: 'Weekend picks' })).json();
    expect(created).toMatchObject({ kind: 'manual', name: 'Weekend picks', itemCount: 0 });
    // Admins see the empty collection so they can fill it; users do not.
    const user = await createUser(env.app, admin, 'viewer');
    expect(await get('/api/collections')).toHaveLength(1);
    expect(await get('/api/collections', user.cookie)).toHaveLength(0);

    await send('POST', `/api/collections/${created.id}/items`, { showId });
    await send('POST', `/api/collections/${created.id}/items`, { movieId: await movieId('Interstellar') });
    await send('POST', `/api/collections/${created.id}/items`, { movieId: await movieId('Interstellar') });
    const detail = await get(`/api/collections/${created.id}`, user.cookie);
    expect(detail.items.map((i: { title: string }) => i.title)).toEqual(['Breaking Bad', 'Interstellar']);
    // Artwork falls back to the first item.
    expect(detail.posterPath).toBe('/bb.jpg');
    expect((await get(`/api/shows/${showId}`, user.cookie)).collections).toEqual([{ id: created.id, name: 'Weekend picks', kind: 'manual' }]);

    await send('PUT', `/api/collections/${created.id}`, { name: 'Favourites of the house', overview: 'Hand-picked.' });
    await send('DELETE', `/api/collections/${created.id}/items/show/${showId}`);
    const renamed = await get(`/api/collections/${created.id}`, user.cookie);
    expect(renamed).toMatchObject({ name: 'Favourites of the house', overview: 'Hand-picked.', itemCount: 1 });

    expect((await send('DELETE', `/api/collections/${created.id}`)).statusCode).toBe(200);
    expect(await get('/api/collections')).toHaveLength(0);
  });

  it('is admin-only to manage', async () => {
    await start();
    const user = await createUser(env.app, admin, 'viewer');
    expect((await send('POST', '/api/collections', { name: 'x' }, user.cookie)).statusCode).toBe(403);
  });
});

describe('collection backfill', () => {
  it('finds collections for movies matched before collections existed', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'The Matrix Reloaded (2003).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    // Simulate a database from before collections: drop what the scan created.
    env.ctx.db.$client.exec('DELETE FROM collections');
    expect(await get('/api/collections')).toHaveLength(0);
    expect(await env.ctx.metadata.backfillCollections()).toBe(true);
    expect(await get('/api/collections')).toMatchObject([{ name: 'The Matrix Collection', itemCount: 2 }]);
  });
});
