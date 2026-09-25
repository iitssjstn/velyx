import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const get = async (url: string) => (await env.app.inject({ url, headers: { cookie: admin } })).json();

describe('movie scanning', () => {
  it('detects movies, parses titles/years and ignores non-video files', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Interstellar.2014.1080p.BluRay.x264.mkv'));
    touch(path.join(root, 'The Matrix (1999)', 'The Matrix (1999).mp4'));
    touch(path.join(root, 'The Matrix (1999)', 'sample.mp4'));
    touch(path.join(root, 'notes.txt'));
    touch(path.join(root, 'cover.jpg'));
    touch(path.join(root, 'Old Film.avi'));
    await addLibrary(env, admin, 'movies', 'movies');
    const list = await get('/api/movies');
    const titles = list.items.map((m: { title: string; year: number | null }) => `${m.title}|${m.year}`).sort();
    expect(titles).toEqual(['Interstellar|2014', 'Old Film|null', 'The Matrix|1999']);
    expect(env.probeCalls).toHaveLength(3);
  });

  it('groups multiple versions of one movie and reports duplicates', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Dune (2021) 1080p.mkv'));
    touch(path.join(root, 'Dune.2021.2160p.mkv'), 'bigger file');
    await addLibrary(env, admin, 'movies', 'movies');
    const list = await get('/api/movies');
    expect(list.total).toBe(1);
    const detail = await get(`/api/movies/${list.items[0].id}`);
    expect(detail.files).toHaveLength(2);
    const dash = await get('/api/admin/dashboard');
    expect(dash.duplicates).toHaveLength(1);
  });

  it('stores technical media information', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const [item] = (await get('/api/movies')).items;
    const detail = await get(`/api/movies/${item.id}`);
    expect(detail.files[0]).toMatchObject({ container: 'mkv', videoCodec: 'h264', width: 1920, height: 1080, audioCodec: 'aac', durationSec: 3600 });
    expect(detail.files[0].audioTracks[0]).toMatchObject({ language: 'eng', languageName: 'English' });
  });

  it('is incremental: unchanged files are not probed again, changed files are', async () => {
    const root = path.join(env.mediaDir, 'movies');
    const a = path.join(root, 'Alien (1979).mkv');
    touch(a);
    touch(path.join(root, 'Aliens (1986).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    expect(env.probeCalls).toHaveLength(2);
    await rescan(env, lib.id);
    expect(env.probeCalls).toHaveLength(2);
    fs.writeFileSync(a, 'changed content with a different size');
    await rescan(env, lib.id);
    expect(env.probeCalls).toHaveLength(3);
    expect(env.probeCalls[2]).toBe(a);
  });

  it('removes deleted files and their orphaned movies', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Alien (1979).mkv'));
    touch(path.join(root, 'Aliens (1986).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    fs.rmSync(path.join(root, 'Aliens (1986).mkv'));
    await rescan(env, lib.id);
    const list = await get('/api/movies');
    expect(list.items.map((m: { title: string }) => m.title)).toEqual(['Alien']);
  });

  it('does not wipe the library when the folder looks empty (unmounted drive)', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Alien (1979).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    fs.rmSync(path.join(root, 'Alien (1979).mkv'));
    await rescan(env, lib.id);
    expect((await get('/api/movies')).total).toBe(1);
  });

  it('marks the scan as failed when the folder disappears', async () => {
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    fs.rmSync(lib.path, { recursive: true });
    await rescan(env, lib.id);
    const libs = await get('/api/libraries');
    expect(libs.libraries[0]).toMatchObject({ lastScanStatus: 'error', available: false });
  });

  it('records probe failures without aborting the scan', async () => {
    await env.cleanup();
    env = await createTestEnv({
      prober: async (file) => {
        if (file.includes('broken')) throw new Error('Invalid data found when processing input');
        return (await import('./helpers.js')).fakeProbe();
      },
    });
    admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'movies', 'broken (2000).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'Fine (2001).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    expect((await get('/api/movies')).total).toBe(2);
    const issues = await get(`/api/libraries/${lib.id}/issues`);
    expect(issues.failed).toHaveLength(1);
    expect(issues.failed[0].error).toContain('Invalid data');
  });
});

describe('TV scanning', () => {
  it('detects shows, seasons and episodes from common naming schemes', async () => {
    const root = path.join(env.mediaDir, 'tv');
    touch(path.join(root, 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E01.720p.mkv'));
    touch(path.join(root, 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E02.mkv'));
    touch(path.join(root, 'Breaking Bad', 'Season 02', 'S02E01.mkv'));
    touch(path.join(root, 'The Office', 'The Office 1x02 Diversity Day.mp4'));
    touch(path.join(root, 'The Office', 'random-bonus-clip.mp4'));
    const lib = await addLibrary(env, admin, 'shows', 'tv');
    const shows = await get('/api/shows');
    expect(shows.items.map((s: { title: string }) => s.title).sort()).toEqual(['Breaking Bad', 'The Office']);
    const bb = shows.items.find((s: { title: string }) => s.title === 'Breaking Bad');
    expect(bb.episodeCount).toBe(3);
    const detail = await get(`/api/shows/${bb.id}`);
    expect(detail.seasons.map((s: { seasonNumber: number }) => s.seasonNumber)).toEqual([1, 2]);
    const s1 = await get(`/api/shows/${bb.id}/seasons/1`);
    expect(s1.episodes.map((e: { episodeNumber: number }) => e.episodeNumber)).toEqual([1, 2]);
    const office = shows.items.find((s: { title: string }) => s.title === 'The Office');
    const off = await get(`/api/shows/${office.id}/seasons/1`);
    expect(off.episodes[0].episodeNumber).toBe(2);
    const issues = await get(`/api/libraries/${lib.id}/issues`);
    expect(issues.unrecognized.map((f: { path: string }) => path.basename(f.path))).toEqual(['random-bonus-clip.mp4']);
  });

  it('links next/previous episodes across seasons', async () => {
    const root = path.join(env.mediaDir, 'tv');
    touch(path.join(root, 'Show', 'S01E01.mkv'));
    touch(path.join(root, 'Show', 'S01E02.mkv'));
    touch(path.join(root, 'Show', 'S02E01.mkv'));
    await addLibrary(env, admin, 'shows', 'tv');
    const [show] = (await get('/api/shows')).items;
    const s1 = await get(`/api/shows/${show.id}/seasons/1`);
    const e2 = await get(`/api/episodes/${s1.episodes[1].id}`);
    expect(e2.next).toMatchObject({ seasonNumber: 2, episodeNumber: 1 });
    expect(e2.previous).toMatchObject({ seasonNumber: 1, episodeNumber: 1 });
  });

  it('removes a show when all its files are gone', async () => {
    const root = path.join(env.mediaDir, 'tv');
    touch(path.join(root, 'Keep', 'S01E01.mkv'));
    touch(path.join(root, 'Gone', 'S01E01.mkv'));
    const lib = await addLibrary(env, admin, 'shows', 'tv');
    fs.rmSync(path.join(root, 'Gone'), { recursive: true });
    await rescan(env, lib.id);
    expect((await get('/api/shows')).items.map((s: { title: string }) => s.title)).toEqual(['Keep']);
  });
});

describe('subtitles', () => {
  it('detects external subtitles and converts SRT to WebVTT', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Amélie (2001).mkv'));
    touch(path.join(root, 'Amélie (2001).nl.srt'), '1\r\n00:00:01,000 --> 00:00:02,500\r\nHallo wereld — één\r\n\r\n');
    touch(path.join(root, 'Amélie (2001).en.forced.srt'), '1\n00:00:03,000 --> 00:00:04,000\nHi\n');
    touch(path.join(root, 'Amélie (2001).vtt'), 'WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nPlain\n');
    await addLibrary(env, admin, 'movies', 'movies');
    const [movie] = (await get('/api/movies')).items;
    const detail = await get(`/api/movies/${movie.id}`);
    const fileId = detail.files[0].id;
    const subs = await get(`/api/media/${fileId}/subtitles`);
    expect(subs).toHaveLength(3);
    const nl = subs.find((s: { language: string }) => s.language === 'nl');
    expect(nl.label).toContain('Dutch');
    const forced = subs.find((s: { language: string }) => s.language === 'en');
    expect(forced.forced).toBe(true);
    const vtt = await env.app.inject({ url: nl.url, headers: { cookie: admin } });
    expect(vtt.headers['content-type']).toContain('text/vtt');
    expect(vtt.body).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHallo wereld — één\n');
  });

  it('removes subtitle rows when the file is deleted', async () => {
    const root = path.join(env.mediaDir, 'movies');
    touch(path.join(root, 'Film (2001).mkv'));
    touch(path.join(root, 'Film (2001).en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nx\n');
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    fs.rmSync(path.join(root, 'Film (2001).en.srt'));
    await rescan(env, lib.id);
    const [movie] = (await get('/api/movies')).items;
    const detail = await get(`/api/movies/${movie.id}`);
    expect(detail.files[0].externalSubtitles).toHaveLength(0);
  });
});

describe('direct play streaming', () => {
  async function setupFile(content: string) {
    touch(path.join(env.mediaDir, 'movies', 'Clip (2020).mp4'), content);
    await addLibrary(env, admin, 'movies', 'movies');
    const [movie] = (await get('/api/movies')).items;
    return (await get(`/api/movies/${movie.id}`)).files[0].id as number;
  }

  it('serves full files and byte ranges', async () => {
    const id = await setupFile('0123456789');
    const full = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin } });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.body).toBe('0123456789');
    const part = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=2-5' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    expect(part.body).toBe('2345');
    const tail = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=-3' } });
    expect(tail.body).toBe('789');
    const open = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=7-' } });
    expect(open.body).toBe('789');
    const bad = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=50-60' } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe('bytes */10');
  });

  it('answers HEAD requests without a body and honours If-Range', async () => {
    const id = await setupFile('abcdef');
    const head = await env.app.inject({ method: 'HEAD', url: `/api/media/${id}/stream`, headers: { cookie: admin } });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('6');
    const stale = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=0-1', 'if-range': '"stale"' } });
    expect(stale.statusCode).toBe(200);
    const etag = head.headers.etag as string;
    const fresh = await env.app.inject({ url: `/api/media/${id}/stream`, headers: { cookie: admin, range: 'bytes=0-1', 'if-range': etag } });
    expect(fresh.statusCode).toBe(206);
  });

  it('returns a playback decision with subtitles', async () => {
    const id = await setupFile('x');
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/media/${id}/playback`,
      headers: { cookie: admin },
      payload: { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'] },
    });
    expect(res.json().decision).toMatchObject({ engine: 'direct', compatible: true, streamUrl: `/api/media/${id}/stream` });
    const unsupported = await env.app.inject({
      method: 'POST',
      url: `/api/media/${id}/playback`,
      headers: { cookie: admin },
      payload: { containers: ['mp4'], videoCodecs: ['vp9'], audioCodecs: ['aac'] },
    });
    expect(unsupported.json().decision.compatible).toBe(false);
    expect(unsupported.json().decision.reasons[0]).toContain('H264');
  });
});
