import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import { episodes, libraries, mediaFiles, movies, playbackSessions, seasons, shows, users } from '../src/db/schema.js';
import { StreamTracker } from '../src/services/streams.js';
import { activityStats, periods } from '../src/services/activity.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(() => env.cleanup());

function movieFile(title = 'Interstellar') {
  const libId = env.ctx.db.select().from(libraries).get()?.id ?? env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
  const movie = env.ctx.db.insert(movies).values({ libraryId: libId, groupKey: title, title, sortTitle: title.toLowerCase(), parsedTitle: title, year: 2014 }).returning().get();
  const file = env.ctx.db
    .insert(mediaFiles)
    .values({ libraryId: libId, movieId: movie.id, path: `/media/m/${title}.mkv`, size: 1, mtimeMs: 1, width: 3840, height: 2160, bitrate: 20_000_000, durationSec: 10140, container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })
    .returning()
    .get();
  return { movie, file };
}

const justin = () => env.ctx.db.select().from(users).where(eq(users.username, 'justin')).get()!;
const rows = () => env.ctx.db.select().from(playbackSessions).all();

describe('recording viewings', () => {
  it('records what was watched, how, and only the time really played', () => {
    const { movie, file } = movieFile();
    const u = justin();
    const t = new StreamTracker(env.ctx.db);
    const t0 = 1_700_000_000_000;
    t.touch(u, file.id, 'remux', 'Chrome on Windows', 'AAC 5.1', t0);
    // Playing: progress every 10 seconds.
    t.progress(u.id, { movieId: movie.id }, 600, t0 + 10_000);
    t.progress(u.id, { movieId: movie.id }, 610, t0 + 20_000);
    t.progress(u.id, { movieId: movie.id }, 620, t0 + 30_000);
    // Paused for 5 minutes: the position does not move.
    t.progress(u.id, { movieId: movie.id }, 620, t0 + 330_000);
    // Seeked 20 minutes ahead: only the few seconds that passed count.
    t.progress(u.id, { movieId: movie.id }, 1830, t0 + 340_000);
    const [live] = t.active(t0 + 341_000);
    expect(live).toMatchObject({ mode: 'remux', audioConversion: 'AAC 5.1', videoCodec: 'hevc', audioCodec: 'eac3', container: 'mkv', height: 2160, device: 'Chrome on Windows', positionSec: 1830 });
    expect(live.watchedSec).toBeGreaterThan(38);
    expect(live.watchedSec).toBeLessThan(55);
    // Nothing more arrives: after a minute the viewing ends at its last sign of life.
    expect(t.active(t0 + 500_000)).toHaveLength(0);
    const [r] = rows();
    expect(r).toMatchObject({ username: 'justin', kind: 'movie', movieId: movie.id, title: 'Interstellar', subtitle: '2014', mode: 'remux', startedAt: t0, endedAt: t0 + 340_000, positionSec: 1830, startPositionSec: 590 });
    expect(r.watchedSec).toBe(Math.round(live.watchedSec));
  });

  it('keeps one viewing through seeks and stream restarts, and a new one per episode', () => {
    const { movie, file } = movieFile();
    const u = justin();
    const t = new StreamTracker(env.ctx.db);
    const t0 = 1_700_000_000_000;
    t.touch(u, file.id, 'direct', null, null, t0);
    t.touch(u, file.id, 'direct', null, null, t0 + 5_000);
    t.progress(u.id, { movieId: movie.id }, 10, t0 + 10_000);
    t.touch(u, file.id, 'direct', null, null, t0 + 40_000);
    expect(rows()).toHaveLength(1);
    const other = movieFile('Heat').file;
    t.touch(u, other.id, 'direct', null, null, t0 + 45_000);
    expect(rows()).toHaveLength(2);
  });

  it('drops streams that were opened but never played, and closes viewings left open by a restart', () => {
    const { movie, file } = movieFile();
    const u = justin();
    const t = new StreamTracker(env.ctx.db);
    const t0 = Date.now() - 1_000_000;
    t.touch(u, file.id, 'direct', null, null, t0);
    t.active(t0 + 200_000);
    expect(rows()).toHaveLength(0);

    t.touch(u, file.id, 'direct', null, null, t0 + 300_000);
    t.progress(u.id, { movieId: movie.id }, 100, t0 + 310_000);
    expect(rows()[0].endedAt).toBeNull();
    // Velyx restarts: the open viewing ends where it was last seen.
    new StreamTracker(env.ctx.db);
    expect(rows()[0].endedAt).toBe(t0 + 310_000);
  });

  it('forgets history older than two years', () => {
    const now = Date.now();
    const base = { username: 'justin', kind: 'movie' as const, title: 'Old', mode: 'direct' as const, lastSeenAt: 0, watchedSec: 600 };
    env.ctx.db.insert(playbackSessions).values([{ ...base, startedAt: now - 800 * 86_400_000 }, { ...base, startedAt: now - 10 * 86_400_000 }]).run();
    expect(env.ctx.streams.purgeHistory(now)).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it('records real stream requests and progress saves', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'), 'x'.repeat(4096));
    await addLibrary(env, admin, 'movies', 'movies');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    const res = await env.app.inject({ url: `/api/media/${file.id}/stream`, headers: { cookie: admin, range: 'bytes=0-99', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' } });
    expect(res.statusCode).toBe(206);
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { movieId: file.movieId, positionSec: 42, durationSec: 3600 } });
    const [r] = rows();
    expect(r).toMatchObject({ username: 'justin', title: 'Heat', mode: 'direct', device: 'Chrome on Windows', positionSec: 42 });
  });
});

describe('statistics', () => {
  function seed(now: number) {
    const lib = env.ctx.db.insert(libraries).values({ name: 't', type: 'shows', path: '/media/t' }).returning().get().id;
    const show = env.ctx.db.insert(shows).values({ libraryId: lib, groupKey: 's', title: 'Severance', sortTitle: 'severance', parsedTitle: 's' }).returning().get();
    const season = env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: 1 }).returning().get();
    const ep = (n: number) => env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: season.id, seasonNumber: 1, episodeNumber: n }).returning().get().id;
    const heat = movieFile('Heat').movie.id;
    const alien = movieFile('Alien').movie.id;
    const day = 86_400_000;
    const s = (o: Partial<typeof playbackSessions.$inferInsert> & { startedAt: number }) => ({ username: 'justin', kind: 'movie' as const, title: 'x', mode: 'direct' as const, lastSeenAt: now, watchedSec: 3600, ...o });
    env.ctx.db
      .insert(playbackSessions)
      .values([
        s({ movieId: heat, title: 'Heat', startedAt: now - 1 * day, device: 'Chrome on Windows' }),
        s({ movieId: heat, title: 'Heat', startedAt: now - 2 * day, username: 'anna', mode: 'remux', audioConversion: 'AAC stereo', device: 'Safari on iPhone' }),
        s({ movieId: alien, title: 'Alien', startedAt: now - 3 * day, watchedSec: 1200, device: 'Chrome on Windows' }),
        s({ kind: 'episode', episodeId: ep(1), showId: show.id, title: 'Severance', startedAt: now - 1 * day, watchedSec: 2400, username: 'anna' }),
        s({ kind: 'episode', episodeId: ep(2), showId: show.id, title: 'Severance', startedAt: now - 1 * day, watchedSec: 2400, username: 'anna' }),
        // Opened for 20 seconds: watch time counts, but it is not a play.
        s({ movieId: alien, title: 'Alien', startedAt: now - 1 * day, watchedSec: 20 }),
        // Outside the last 7 days.
        s({ movieId: alien, title: 'Alien', startedAt: now - 20 * day, watchedSec: 5000 }),
      ])
      .run();
    return { heat, alien, show: show.id };
  }

  it('sums plays, watch time, titles, users, modes, clients and the top lists', () => {
    const now = Date.now();
    const ids = seed(now);
    const s = activityStats(env.ctx.db, 7, now);
    expect(s.totals).toEqual({ plays: 5, watchSec: 3600 + 3600 + 1200 + 2400 + 2400 + 20, movies: 2, episodes: 2, users: 2 });
    expect(s.modes).toEqual({ direct: { plays: 4, watchSec: 3600 + 1200 + 4800 + 20 }, remux: { plays: 1, watchSec: 3600 }, audioConverted: 1 });
    expect(s.topMovies[0]).toMatchObject({ id: ids.heat, title: 'Heat', plays: 2 });
    expect(s.topMovies[1]).toMatchObject({ id: ids.alien, plays: 1 });
    expect(s.topShows[0]).toMatchObject({ id: ids.show, title: 'Severance', plays: 2, watchSec: 4800 });
    expect(s.topUsers.map((u) => u.username)).toEqual(['anna', 'justin']);
    expect(s.clients.find((c) => c.device === 'Chrome on Windows')).toMatchObject({ plays: 2, watchSec: 3600 + 1200 });
    expect(s.clients[0]).toMatchObject({ device: 'Unknown', plays: 2 });
    expect(s.granularity).toBe('day');
    expect(s.timeline).toHaveLength(8);
    expect(s.timeline.reduce((n, p) => n + p.watchSec, 0)).toBe(s.totals.watchSec);
    const year = activityStats(env.ctx.db, 365, now);
    expect(year.granularity).toBe('month');
    expect(year.totals.plays).toBe(6);
    expect(year.timeline.reduce((n, p) => n + p.watchSec, 0)).toBe(year.totals.watchSec);
  });

  it('builds gapless periods by day, week (from Monday) and month', () => {
    const now = new Date(2026, 8, 26, 12).getTime(); // Saturday 26 September 2026
    expect(periods(now - 2 * 86_400_000, now, 'day')).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    expect(periods(now - 14 * 86_400_000, now, 'week')).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    expect(periods(now - 70 * 86_400_000, now, 'month')).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('activity API', () => {
  it('gives admins stats, streams and the full log, with filters', async () => {
    const now = Date.now();
    const anna = await createUser(env.app, admin, 'anna');
    const base = { kind: 'movie' as const, title: 'Heat', mode: 'direct' as const, lastSeenAt: now, watchedSec: 900 };
    env.ctx.db
      .insert(playbackSessions)
      .values([
        { ...base, username: 'justin', userId: justin().id, startedAt: now - 3000 },
        { ...base, username: 'anna', userId: anna.id, startedAt: now - 2000 },
        { ...base, username: 'anna', userId: anna.id, kind: 'episode', title: 'Severance', startedAt: now - 1000 },
      ])
      .run();
    const a = (await env.app.inject({ url: '/api/admin/activity?days=30', headers: { cookie: admin } })).json();
    expect(a.stats.totals.plays).toBe(3);
    expect(a.streams).toEqual([]);
    const all = (await env.app.inject({ url: '/api/admin/activity/history', headers: { cookie: admin } })).json();
    expect(all.total).toBe(3);
    expect(all.items[0].title).toBe('Severance');
    expect(all.items[0]).not.toHaveProperty('lastSeenAt');
    const annaMovies = (await env.app.inject({ url: `/api/admin/activity/history?userId=${anna.id}&kind=movie`, headers: { cookie: admin } })).json();
    expect(annaMovies.total).toBe(1);
    const paged = (await env.app.inject({ url: '/api/admin/activity/history?limit=2&page=2', headers: { cookie: admin } })).json();
    expect(paged.items.map((i: { username: string }) => i.username)).toEqual(['justin']);
    expect((await env.app.inject({ url: '/api/admin/activity?days=12', headers: { cookie: admin } })).statusCode).toBe(400);

    // Users see only their own history, and none of the admin views.
    const own = (await env.app.inject({ url: `/api/account/history?userId=${justin().id}`, headers: { cookie: anna.cookie } })).json();
    expect(own.total).toBe(2);
    expect(own.items.every((i: { username: string }) => i.username === 'anna')).toBe(true);
    expect((await env.app.inject({ url: '/api/admin/activity', headers: { cookie: anna.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/activity/history', headers: { cookie: anna.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/account/history' })).statusCode).toBe(401);
  });

  it('keeps the history readable after the user and media are removed', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    const { file } = movieFile();
    const t = new StreamTracker(env.ctx.db);
    t.touch({ id: anna.id, username: 'anna' }, file.id, 'direct', null, null, Date.now());
    expect((await env.app.inject({ method: 'DELETE', url: `/api/users/${anna.id}`, headers: { cookie: admin } })).statusCode).toBe(200);
    env.ctx.db.delete(movies).run();
    const [r] = rows();
    expect(r).toMatchObject({ userId: null, username: 'anna', movieId: null, title: 'Interstellar' });
  });
});
