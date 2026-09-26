import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { episodes, libraries, mediaFiles, movies, seasons, shows, type SubtitleTrackInfo } from '../src/db/schema.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const sub = (codec: string, textBased: boolean): SubtitleTrackInfo => ({ index: 3, codec, language: 'eng', title: null, isDefault: false, isForced: false, textBased });

function seed() {
  const db = env.ctx.db;
  const movieLib = db.insert(libraries).values({ name: 'Films', type: 'movies', path: '/media/films' }).returning().get().id;
  const tvLib = db.insert(libraries).values({ name: 'Series', type: 'shows', path: '/media/tv' }).returning().get().id;
  let n = 0;
  const movie = (title: string, file: Partial<typeof mediaFiles.$inferInsert> | null, extra: Partial<typeof movies.$inferInsert> = {}) => {
    const m = db
      .insert(movies)
      .values({ libraryId: movieLib, groupKey: `${title}-${n++}`, title, sortTitle: title.toLowerCase(), parsedTitle: title, year: 2020, matchStatus: 'matched', overview: 'Story.', posterPath: '/p.jpg', ...extra })
      .returning()
      .get();
    if (file) addFile(m.id, title, file);
    return m.id;
  };
  const addFile = (movieId: number, name: string, file: Partial<typeof mediaFiles.$inferInsert>) =>
    db
      .insert(mediaFiles)
      .values({ libraryId: movieLib, movieId, path: `/media/films/${name}-${n++}.mkv`, size: 2 * 1024 ** 3, mtimeMs: 1, container: 'mp4', videoCodec: 'h264', videoBitDepth: 8, videoRange: 'SDR', width: 1920, height: 1080, audioCodec: 'aac', audioChannels: 2, ...file })
      .run();

  const ids = {
    plain: movie('Plain', {}),
    dts: movie('Dts Movie', { container: 'mkv', audioCodec: 'dts', audioChannels: 6, subtitleTracks: [sub('hdmv_pgs_subtitle', false), sub('subrip', true)] }),
    hevc: movie('Hevc Hdr', { container: 'mkv', videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', width: 3840, height: 2160, audioCodec: 'eac3', audioChannels: 6 }),
    hi10p: movie('Anime Hi10p', { container: 'mkv', videoBitDepth: 10 }),
    divx: movie('Old Divx', { container: 'avi', videoCodec: 'mpeg4', audioCodec: 'mp3' }),
    broken: movie('Broken', { videoCodec: null, videoBitDepth: null, videoRange: null, audioCodec: null, probeError: 'Invalid data found when processing input' }),
    av1: movie('Av1 Dv', { videoCodec: 'av1', videoBitDepth: 10, videoRange: 'DV' }),
    old: movie('Scanned Before 04', { videoBitDepth: null, videoRange: null }),
    twoFiles: movie('Two Versions', { width: 1920, height: 1080 }),
    pending: movie('Waiting', {}, { matchStatus: 'pending', overview: null, posterPath: null }),
    copyA: movie('Heat', {}, { tmdbId: 949 }),
    copyB: movie('Heat Directors Cut', {}, { tmdbId: 949 }),
  };
  addFile(ids.twoFiles, 'Two Versions 4K', { videoCodec: 'hevc', width: 3840, height: 2160 });

  const show = db.insert(shows).values({ libraryId: tvLib, groupKey: 'show', title: 'Dvd Show', sortTitle: 'dvd show', parsedTitle: 'Dvd Show', matchStatus: 'unmatched', posterPath: null }).returning().get().id;
  const season = db.insert(seasons).values({ showId: show, seasonNumber: 1 }).returning().get().id;
  const ep = db.insert(episodes).values({ showId: show, seasonId: season, seasonNumber: 1, episodeNumber: 2, title: 'Pilot' }).returning().get().id;
  db.insert(mediaFiles)
    .values({ libraryId: tvLib, episodeId: ep, path: '/media/tv/Dvd Show/S01E02.mkv', size: 700 * 1024 ** 2, mtimeMs: 1, container: 'mkv', videoCodec: 'h264', videoBitDepth: 8, videoRange: 'SDR', width: 720, height: 576, audioCodec: 'ac3', audioChannels: 2, subtitleTracks: [sub('dvd_subtitle', false)] })
    .run();
  return { movieLib, tvLib, show, ...ids };
}

const get = async (url: string, cookie = admin) => {
  const res = await env.app.inject({ url, headers: { cookie } });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json();
};

describe('library health', () => {
  it('counts every category from stored data only', async () => {
    seed();
    const probesBefore = env.probeCalls.length;
    const health = await get('/api/admin/health');
    const count = Object.fromEntries(health.categories.map((c: { key: string; count: number }) => [c.key, c.count]));
    expect(count).toEqual({
      direct: 7, // Plain, Waiting, Heat ×2, Scanned Before 04, Two Versions (1080p H.264), Av1 Dv
      remux: 2, // Dts Movie, the DVD episode (AC3)
      'browser-dependent': 2, // Hevc Hdr, Two Versions 4K
      unsupported: 2, // Hi10P, DivX
      hevc: 2,
      av1: 1,
      '10-bit': 3,
      hdr: 1,
      'dolby-vision': 1,
      'unsupported-audio': 3, // DTS, E-AC3, AC3
      pgs: 1,
      vobsub: 1,
      'missing-metadata': 2, // Waiting (pending), Dvd Show (unmatched)
      'missing-artwork': 2,
      'scan-errors': 1,
      'not-analyzed': 1,
      duplicates: 3, // Two Versions, Heat, Heat Directors Cut
    });
    expect(health.files).toBe(14);
    expect(health.tmdbConfigured).toBe(false);
    expect(env.probeCalls.length).toBe(probesBefore);
  });

  it('lists the affected items with understandable reasons', async () => {
    const s = seed();
    const unsupported = await get('/api/admin/health/unsupported');
    expect(unsupported.total).toBe(2);
    expect(unsupported.items.map((i: { title: string }) => i.title)).toEqual(['Anime Hi10p', 'Old Divx']);
    expect(unsupported.items[0]).toMatchObject({
      kind: 'movie',
      id: s.hi10p,
      href: `/movies/${s.hi10p}`,
      library: 'Films',
      file: { summary: 'H.264 · 1080p · 10-bit · AAC stereo · MKV' },
      reasons: [expect.stringMatching(/10-bit H\.264.*cannot be decoded/), 'Velyx does not transcode video.'],
    });
    expect(unsupported.items[1].reasons[0]).toMatch(/MPEG-4 Part 2.*cannot be decoded/);
    // Paths are shown relative to the library folder.
    expect(unsupported.items[0].file.path).toMatch(/^Anime Hi10p-\d+\.mkv$/);

    const remux = await get('/api/admin/health/remux');
    const episode = remux.items.find((i: { kind: string }) => i.kind === 'episode');
    expect(episode).toMatchObject({ title: 'Dvd Show', subtitle: 'S01E02 · Pilot', href: `/shows/${s.show}`, library: 'Series' });
    expect(episode.reasons).toContain('Dolby Digital (AC3) audio is converted to AAC.');

    const errors = await get('/api/admin/health/scan-errors');
    expect(errors.items[0].reasons).toEqual(['Invalid data found when processing input']);

    const meta = await get('/api/admin/health/missing-metadata');
    expect(meta.items.map((i: { title: string; kind: string }) => `${i.kind}:${i.title}`)).toEqual(['show:Dvd Show', 'movie:Waiting']);
    expect(meta.items[1].reasons[0]).toMatch(/TMDB is not configured/);

    const dupes = await get('/api/admin/health/duplicates');
    const two = dupes.items.find((i: { title: string }) => i.title === 'Two Versions');
    expect(two.reasons[0]).toBe('2 versions:');
    expect(two.reasons.slice(1).join('\n')).toMatch(/HEVC · 2160p/);
    const heat = dupes.items.find((i: { title: string }) => i.title === 'Heat');
    expect(heat.reasons[0]).toMatch(/same TMDB movie as “Heat Directors Cut \(2020\)”/);
  });

  it('filters by library and pages through long lists', async () => {
    const s = seed();
    const tv = await get(`/api/admin/health?libraryId=${s.tvLib}`);
    const count = Object.fromEntries(tv.categories.map((c: { key: string; count: number }) => [c.key, c.count]));
    expect(count).toMatchObject({ direct: 0, remux: 1, vobsub: 1, 'missing-metadata': 1, duplicates: 0 });
    const page1 = await get('/api/admin/health/direct?limit=5&page=1');
    const page2 = await get('/api/admin/health/direct?limit=5&page=2');
    expect(page1.total).toBe(7);
    expect(page1.items).toHaveLength(5);
    expect(page2.items).toHaveLength(2);
    expect(new Set([...page1.items, ...page2.items].map((i: { file: { id: number } }) => i.file.id)).size).toBe(7);
  });

  it('is for administrators only and validates its input', async () => {
    seed();
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ url: '/api/admin/health', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/health/unsupported', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/health' })).statusCode).toBe(401);
    expect((await env.app.inject({ url: '/api/admin/health/nonsense', headers: { cookie: admin } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/admin/health?libraryId=999', headers: { cookie: admin } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/admin/health/direct?limit=5000', headers: { cookie: admin } })).statusCode).toBe(400);
    expect((await env.app.inject({ url: '/api/admin/health?libraryId=abc', headers: { cookie: admin } })).statusCode).toBe(400);
  });

  it('stays fast on a large library', async () => {
    const db = env.ctx.db;
    const lib = db.insert(libraries).values({ name: 'Big', type: 'movies', path: '/media/big' }).returning().get().id;
    db.transaction((tx) => {
      for (let i = 0; i < 20_000; i++) {
        const m = tx.insert(movies).values({ libraryId: lib, groupKey: `g${i}`, title: `Movie ${i}`, sortTitle: `movie ${i}`, parsedTitle: 'm', matchStatus: 'matched', overview: 'x', posterPath: '/p.jpg' }).returning({ id: movies.id }).get();
        tx.insert(mediaFiles).values({ libraryId: lib, movieId: m.id, path: `/media/big/${i}.mkv`, size: 1, mtimeMs: 1, container: 'mkv', videoCodec: i % 3 ? 'h264' : 'hevc', videoBitDepth: 8, videoRange: 'SDR', audioCodec: i % 2 ? 'aac' : 'dts' }).run();
      }
    });
    const t0 = performance.now();
    const summary = await get('/api/admin/health');
    const list = await get('/api/admin/health/remux?limit=50');
    const ms = performance.now() - t0;
    expect(summary.files).toBe(20_000);
    expect(list.items).toHaveLength(50);
    expect(ms).toBeLessThan(3000);
  });
});
