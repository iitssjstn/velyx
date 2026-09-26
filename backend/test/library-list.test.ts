import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { libraries, mediaFiles, movies } from '../src/db/schema.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let libId: number;

type Seed = { title: string; year?: number | null; rating?: number | null; runtime?: number | null; width?: number; height?: number; range?: 'SDR' | 'HDR10'; addedAt?: number };

function seedMovie(s: Seed): number {
  const db = env.ctx.db;
  const m = db
    .insert(movies)
    .values({ libraryId: libId, groupKey: s.title, title: s.title, sortTitle: s.title.toLowerCase(), parsedTitle: s.title, year: s.year ?? null, rating: s.rating ?? null, runtime: s.runtime ?? null, matchStatus: 'matched', addedAt: s.addedAt ?? Date.now() })
    .returning()
    .get();
  db.insert(mediaFiles)
    .values({ libraryId: libId, movieId: m.id, path: `/media/m/${s.title}.mkv`, size: 1, mtimeMs: 1, width: s.width ?? 1920, height: s.height ?? 1080, videoRange: s.range ?? 'SDR', videoCodec: 'h264' })
    .run();
  return m.id;
}

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  libId = env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
});
afterEach(async () => {
  await env.cleanup();
});

async function list(query: string, cookie = admin) {
  const res = await env.app.inject({ url: `/api/movies?${query}`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { items: { id: number; title: string }[]; total: number; page: number; pageSize: number };
}
const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

describe('library filters (server-side)', () => {
  beforeEach(() => {
    seedMovie({ title: 'Alpha', year: 1994, rating: 8.1, runtime: 142, width: 3840, height: 2160, range: 'HDR10', addedAt: 3 });
    seedMovie({ title: 'Bravo', year: 2004, rating: 6.5, runtime: 95, addedAt: 1 });
    seedMovie({ title: 'Charlie', year: 1998, rating: 7.2, runtime: 180, width: 1280, height: 720, addedAt: 2 });
    seedMovie({ title: 'Delta', year: null, rating: null, runtime: null, width: 640, height: 360, addedAt: 4 });
  });

  it('filters by resolution, HDR, year range and rating', async () => {
    expect(titles(await list('resolution=4k'))).toEqual(['Alpha']);
    expect(titles(await list('resolution=1080p'))).toEqual(['Bravo']);
    expect(titles(await list('resolution=720p'))).toEqual(['Charlie']);
    expect(titles(await list('resolution=sd'))).toEqual(['Delta']);
    expect(titles(await list('hdr=1'))).toEqual(['Alpha']);
    expect(titles(await list('yearFrom=1990&yearTo=2000'))).toEqual(['Alpha', 'Charlie']);
    expect(titles(await list('minRating=7'))).toEqual(['Alpha', 'Charlie']);
    expect((await list('yearFrom=1990&minRating=8&resolution=4k')).total).toBe(1);
  });

  it('filters by the viewer’s favorites, watchlist and watch state', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    const ids = Object.fromEntries((await list('')).items.map((i) => [i.title, i.id]));
    const post = (url: string, payload: object) => env.app.inject({ method: 'POST', url, headers: { cookie: user.cookie }, payload });
    await post('/api/favorites', { movieId: ids.Bravo });
    await post('/api/watchlist', { movieId: ids.Charlie });
    await post('/api/progress', { movieId: ids.Alpha, positionSec: 95, durationSec: 100 });
    await post('/api/progress', { movieId: ids.Delta, positionSec: 300, durationSec: 1000 });
    expect(titles(await list('filter=favorites', user.cookie))).toEqual(['Bravo']);
    expect(titles(await list('filter=watchlist', user.cookie))).toEqual(['Charlie']);
    expect(titles(await list('filter=watched', user.cookie))).toEqual(['Alpha']);
    expect(titles(await list('filter=in-progress', user.cookie))).toEqual(['Delta']);
    expect(titles(await list('filter=unwatched', user.cookie))).toEqual(['Bravo', 'Charlie', 'Delta']);
    // Another user's lists are separate.
    expect((await list('filter=favorites')).total).toBe(0);
  });

  it('sorts with missing values last', async () => {
    expect(titles(await list('sort=year'))).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
    expect(titles(await list('sort=year&order=asc'))).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta']);
    expect(titles(await list('sort=rating'))).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta']);
    expect(titles(await list('sort=runtime'))).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
    expect(titles(await list('sort=added'))).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);
    expect(titles(await list('sort=title'))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('sorts by recently watched', async () => {
    const ids = Object.fromEntries((await list('')).items.map((i) => [i.title, i.id]));
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { movieId: ids.Charlie, positionSec: 40, durationSec: 1000 } });
    await new Promise((r) => setTimeout(r, 5));
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { movieId: ids.Bravo, positionSec: 40, durationSec: 1000 } });
    expect(titles(await list('sort=watched')).slice(0, 2)).toEqual(['Bravo', 'Charlie']);
  });

  it('validates query parameters', async () => {
    for (const q of ['resolution=8k', 'sort=random', 'limit=1000', 'yearFrom=12', 'minRating=11']) {
      expect((await env.app.inject({ url: `/api/movies?${q}`, headers: { cookie: admin } })).statusCode, q).toBe(400);
    }
  });
});

describe('large libraries', () => {
  it('pages through 5,000 movies quickly', async () => {
    const db = env.ctx.db;
    db.transaction((tx) => {
      for (let i = 0; i < 5000; i++) {
        const m = tx.insert(movies).values({ libraryId: libId, groupKey: `g${i}`, title: `Movie ${i}`, sortTitle: `movie ${String(i).padStart(5, '0')}`, parsedTitle: 'x', year: 1950 + (i % 70), rating: (i % 100) / 10, addedAt: i }).returning({ id: movies.id }).get();
        tx.insert(mediaFiles).values({ libraryId: libId, movieId: m.id, path: `/media/m/${i}.mkv`, size: 1, mtimeMs: 1, width: i % 3 ? 1920 : 3840, height: i % 3 ? 1080 : 2160 }).run();
      }
    });
    const started = performance.now();
    const page = await list('limit=60&page=20&sort=rating&resolution=4k');
    const elapsed = performance.now() - started;
    expect(page.items).toHaveLength(60);
    expect(page.total).toBe(1667);
    // Generous bound so slow CI runners pass; typical is a few ms.
    expect(elapsed).toBeLessThan(1500);
    expect(db.select().from(movies).where(eq(movies.libraryId, libId)).all().length).toBe(5000);
  });
});
