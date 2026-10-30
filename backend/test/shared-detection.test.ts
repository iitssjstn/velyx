import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { episode, melody } from './segments-helpers.js';
import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import type { AudioReader } from '../src/services/segments/detector.js';
import { episodes, episodeSegments, sharedDetectionCache, shows } from '../src/db/schema.js';
import { playbackSegments } from '../src/services/segments/store.js';
import { overridesFor, PROFILE_FRESH_MS, SHARED_SYNC_MS, SharedDetection, sharedFor, sharedReferences, shareState, weakest, type SharedProfile } from '../src/services/segments/shared.js';
import { mediaFiles } from '../src/db/schema.js';
import { SettingsService } from '../src/services/settings.js';

/**
 * The real account service (vidalune.com), in this process. Loaded at run time: it is another
 * package, not part of the server's own program.
 */
const cloudSrc = path.resolve(import.meta.dirname, '../../cloud/src');
type CloudDb = { $client: { close(): void } };
async function cloudModules() {
  const load = (file: string) => import(/* @vite-ignore */ path.join(cloudSrc, file));
  const [{ buildCloudApp }, { loadConfig }, { openDatabase }] = await Promise.all([load('app.ts'), load('config.ts'), load('db/client.ts')]);
  return {
    buildCloudApp: buildCloudApp as (config: unknown, db: CloudDb, opts: object) => Promise<FastifyInstance>,
    loadCloudConfig: loadConfig as (env: Record<string, string>, opts: object) => { dbPath: string },
    openCloudDatabase: openDatabase as (file: string) => CloudDb,
  };
}

const INTRO = melody(30, 101);
const CREDITS = melody(40, 303);
const LAYOUT: Record<string, { cold: number; seed: number }> = {
  'S01E01.mkv': { cold: 20, seed: 1 },
  'S01E02.mkv': { cold: 35, seed: 2 },
  'S01E03.mkv': { cold: 10, seed: 3 },
};
const TMDB = 4242;
const audio = new Map<string, Int16Array>();
const name = (file: string) => path.basename(file).replace('The.Show.', '');
function audioOf(file: string): Int16Array {
  const key = name(file);
  if (!audio.has(key)) {
    const l = LAYOUT[key];
    audio.set(key, episode([melody(l.cold, l.seed * 10), INTRO, melody(200 - l.cold, l.seed * 10 + 1), CREDITS], l.seed));
  }
  return audio.get(key)!;
}

// ---- vidalune.com
let cloudDir: string;
let cloud: FastifyInstance;
let cloudDb: CloudDb;
const sent: Array<{ path: string; body: unknown }> = [];
beforeAll(async () => {
  const { buildCloudApp, loadCloudConfig, openCloudDatabase } = await cloudModules();
  cloudDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadCloudConfig({ DATA_DIR: cloudDir, PUBLIC_URL: 'https://vidalune.com' }, { webDir: null, frontendDir: null });
  cloudDb = openCloudDatabase(config.dbPath);
  cloud = await buildCloudApp(config, cloudDb, {});
});
afterAll(async () => {
  await cloud.close();
  cloudDb.$client.close();
  fs.rmSync(cloudDir, { recursive: true, force: true });
});

/** Requests to vidalune.com go to the service above; nothing else is reachable. */
async function toCloud(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  if (u.origin !== 'https://vidalune.com') throw new Error('connect ECONNREFUSED');
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  sent.push({ path: u.pathname, body });
  const res = await cloud.inject({ method: (init?.method ?? 'GET') as 'GET', url: `${u.pathname}${u.search}`, headers: init?.headers as Record<string, string>, payload: body });
  return new Response(res.body, { status: res.statusCode, headers: { 'Content-Type': 'application/json' } });
}

// ---- Vidalune servers
const envs: TestEnv[] = [];
afterEach(async () => {
  while (envs.length) await envs.pop()!.cleanup();
});

/** A server known to vidalune.com with (some of) the season; `broken` files cannot be read. Shares without any setting. */
async function server(files: string[], broken: string[] = []) {
  const reader: AudioReader = async (file, start, duration) => {
    if (broken.includes(name(file))) throw new Error('Invalid data found when processing input');
    return audioOf(file).slice(Math.round(start * SAMPLE_RATE), Math.round((start + duration) * SAMPLE_RATE));
  };
  const env = await createTestEnv({ audioReader: reader, segmentRetryMs: 20, fetchImpl: toCloud, prober: async (file) => fakeProbe({ durationSec: audioOf(file).length / SAMPLE_RATE }) });
  envs.push(env);
  env.ctx.settings.update({ segmentDetection: false });
  const admin = await setupAdmin(env.app);
  for (const f of files) touch(path.join(env.mediaDir, 'tv', 'The Show', 'Season 01', `The.Show.${f}`));
  await addLibrary(env, admin, 'shows', 'tv');
  env.ctx.db.update(shows).set({ tmdbId: TMDB }).run();
  // Linked (or registered) earlier; nothing to turn on for sharing.
  await env.ctx.cloud.ensureRegistered();
  const on = await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { segmentDetection: true } });
  expect(on.statusCode).toBe(200);
  expect(on.json().sharedDetection).toBeUndefined();
  await env.ctx.segments.whenIdle();
  const showId = env.ctx.db.select().from(shows).get()!.id;
  // What the detector reports in the background, done now.
  await env.ctx.sharedDetection.report(showId, 1);
  return { env, admin, showId };
}

const seg = (env: TestEnv, n: number) => {
  const ep = env.ctx.db.select().from(episodes).all().find((e) => e.episodeNumber === n)!;
  return { id: ep.id, row: env.ctx.db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, ep.id)).get()! };
};

describe('shared detection between servers', () => {
  it('finds what one server cannot alone, labels how sure it is, and sends only timings', async () => {
    const a = await server(Object.keys(LAYOUT));
    expect(seg(a.env, 2).row).toMatchObject({ introSource: 'audio', introConfidence: 'high', shareState: 'pending' });
    const c = await server(Object.keys(LAYOUT));
    // A second server found the same: shared.
    expect(seg(c.env, 2).row.shareState).toBe('shared');
    await a.env.ctx.sharedDetection.report(a.showId, 1);
    expect(seg(a.env, 1).row.shareState).toBe('shared');

    // A third server has two episodes, and one of them cannot be read.
    const b = await server(['S01E02.mkv', 'S01E03.mkv'], ['S01E03.mkv']);
    // The unreadable one gets what the other two agree on (the same cut: same length).
    const e3 = seg(b.env, 3).row;
    expect(e3).toMatchObject({ status: 'analyzed', introSource: 'shared', introConfidence: 'medium', creditsSource: 'shared' });
    expect(Math.abs(e3.introStart! - 10)).toBeLessThan(1.5);
    expect(playbackSegments(b.env.ctx.db, seg(b.env, 3).id)?.intro).toMatchObject({ confidence: 'medium' });
    // The readable one is found in its own audio (with the others' fingerprints to compare with) and now three agree.
    const e2 = seg(b.env, 2).row;
    expect(e2).toMatchObject({ introSource: 'audio', introConfidence: 'high', shareState: 'verified' });
    expect(Math.abs(e2.introStart! - 35)).toBeLessThan(1.5);

    // Only numbers go to vidalune.com: no titles, paths or users.
    const reports = sent.filter((s) => s.path === '/api/detection/reports').map((s) => JSON.stringify(s.body));
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r).not.toMatch(/The Show|\.mkv|admin|media/i);
      expect(Object.keys(JSON.parse(r)).sort()).toEqual(['episodes', 'prints', 'season', 'tmdbShow']);
    }
    // What was taken from others is never reported as found here.
    const fromB = sent.filter((s) => s.path === '/api/detection/reports').at(-1)!.body as { episodes: Array<{ episode: number; parts: unknown[] }> };
    expect(fromB.episodes.find((e) => e.episode === 3)?.parts ?? []).toEqual([]);

    expect(b.env.ctx.segments.status().counts).toMatchObject({ fromShared: 1 });
  }, 120_000);

  it('stays local and silent on a server not known to vidalune.com, and never registers it for this', async () => {
    const env = await createTestEnv({ fetchImpl: toCloud });
    envs.push(env);
    const admin = await setupAdmin(env.app);
    const before = sent.length;
    expect(await env.ctx.sharedDetection.profile(1, 1)).toBeNull();
    expect(await env.ctx.sharedDetection.syncAll(0)).toBe(0);
    expect(sent.length).toBe(before);
    expect(env.ctx.settings.get().cloud).toBeNull();
    // The old switch is gone: sending it changes nothing.
    const res = await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { sharedDetection: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sharedDetection).toBeUndefined();
    expect(env.ctx.settings.get().cloud).toBeNull();
    expect(sent.length).toBe(before);
  });

  it('shares by default; switched off it sends nothing but still takes corrections and what others agree on', async () => {
    const a = await server(Object.keys(LAYOUT));
    expect(a.env.ctx.settings.get().shareDetection).toBe(true);
    const length = a.env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, seg(a.env, 2).id)).get()!.durationSec!;
    const off = await a.env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: a.admin }, payload: { shareDetection: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().shareDetection).toBe(false);
    expect((await a.env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: a.admin }, payload: { shareDetection: 'no' } })).statusCode).toBe(400);
    const posts: unknown[] = [];
    const asked: number[] = [];
    const shared = new SharedDetection(
      a.env.ctx.db,
      {
        registered: () => true,
        detectionProfile: async <T,>(tmdb: number) => {
          asked.push(tmdb);
          return profile({ tmdbShow: TMDB, overrides: [{ episode: 2, kind: 'intro', duration: length, start: 37, end: 67 }] }) as T;
        },
        reportDetection: async <T,>(body: unknown) => {
          posts.push(body);
          return profile() as T;
        },
      },
      () => a.env.ctx.settings.get().shareDetection,
    );
    await shared.report(a.showId, 1);
    await shared.syncAll(0);
    expect(posts).toEqual([]);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(seg(a.env, 2).row).toMatchObject({ introStart: 37, introEnd: 67, introSource: 'central' });
    // On again: it reports.
    a.env.ctx.settings.update({ shareDetection: true });
    await shared.report(a.showId, 1);
    expect(posts).toHaveLength(1);
  }, 120_000);

  it('is not held back by the old opt-in switch that older versions stored as off', async () => {
    const env = await createTestEnv();
    envs.push(env);
    env.ctx.db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sharedDetection', 'false')").run();
    // Read fresh from the database, as after an upgrade.
    expect(new SettingsService(env.ctx.db, env.ctx.config).get().shareDetection).toBe(true);
  });

  it('sends a correction by hand from the admin page as a proposal', async () => {
    const a = await server(Object.keys(LAYOUT));
    const before = sent.length;
    const id = seg(a.env, 1).id;
    const put = await a.env.app.inject({ method: 'PUT', url: `/api/admin/segments/episodes/${id}`, headers: { cookie: a.admin }, payload: { intro: { start: 19, end: 49 }, credits: null, postCredits: null } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ manual: true, intro: { start: 19, end: 49, source: 'manual' } });
    await new Promise((r) => setTimeout(r, 50));
    const report = sent.slice(before).filter((x) => x.path === '/api/detection/reports').at(-1)?.body as { episodes: Array<{ episode: number; parts: Array<{ kind: string; source: string; start: number }> }> } | undefined;
    expect(report?.episodes.find((e) => e.episode === 1)?.parts).toEqual([expect.objectContaining({ kind: 'intro', source: 'manual', start: 19 })]);
  }, 120_000);

  it('puts in the Control Center\'s corrections over anything found here, also a correction by hand, and lets go of them when removed', async () => {
    const a = await server(Object.keys(LAYOUT));
    const length = (n: number) => a.env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, seg(a.env, n).id)).get()!.durationSec!;
    // Episode 1 was corrected by hand here (intro and credits).
    a.env.ctx.db.update(episodeSegments).set({ manual: true, method: 'manual', introStart: 12, introEnd: 44, introSource: 'manual', creditsStart: 200, creditsEnd: 240, creditsSource: 'manual' }).where(eq(episodeSegments.episodeId, seg(a.env, 1).id)).run();
    const e3 = seg(a.env, 3).row;
    let overrides: SharedProfile['overrides'] = [
      { episode: 1, kind: 'intro', duration: length(1), start: 21, end: 51 },
      { episode: 2, kind: 'intro', duration: length(2) + 1, start: 36, end: 66 },
      // Another cut of episode 3: not this file.
      { episode: 3, kind: 'intro', duration: length(3) + 60, start: 1, end: 5 },
    ];
    const bodies: unknown[] = [];
    const shared = new SharedDetection(a.env.ctx.db, {
      registered: () => true,
      detectionProfile: async <T,>() => profile({ overrides }) as T,
      reportDetection: async <T,>(body: unknown) => {
        bodies.push(body);
        return profile({ tmdbShow: TMDB, overrides }) as T;
      },
    });
    await shared.report(a.showId, 1);
    // Shown on the admin page as set on vidalune.com.
    expect(seg(a.env, 2).row).toMatchObject({ introStart: 36, introEnd: 66, introConfidence: 'high', introSource: 'central' });
    expect(playbackSegments(a.env.ctx.db, seg(a.env, 2).id)?.intro).toMatchObject({ start: 36, end: 66 });
    // Over the correction by hand; the rest of that correction still holds.
    expect(seg(a.env, 1).row).toMatchObject({ manual: true, introStart: 21, introEnd: 51, introSource: 'central', creditsStart: 200, creditsEnd: 240 });
    // The admin page shows which parts were set on vidalune.com.
    const page = (await a.env.app.inject({ method: 'GET', url: `/api/admin/segments/shows/${a.showId}`, headers: { cookie: a.admin } })).json();
    const ep1 = page.seasons[0].episodes.find((e: { episodeNumber: number }) => e.episodeNumber === 1);
    expect(ep1.segments).toMatchObject({ manual: true, intro: { start: 21, end: 51, source: 'central' }, credits: { start: 200, end: 240, source: 'manual' } });
    expect(seg(a.env, 3).row).toMatchObject({ introStart: e3.introStart, introSource: 'audio' });

    // Reported: the correction by hand as a proposal, never the Control Center's own timing.
    await shared.report(a.showId, 1);
    const last = bodies.at(-1) as { episodes: Array<{ episode: number; parts: Array<{ kind: string; source: string }> }> };
    const parts = (n: number) => last.episodes.find((e) => e.episode === n)!.parts;
    expect(parts(1)).toEqual([expect.objectContaining({ kind: 'credits', source: 'manual', start: 200, end: 240 })]);
    expect(parts(2).map((p) => p.kind)).not.toContain('intro');

    // Removed in the Control Center: let go, and episode 2 is analysed again by the usual rules.
    overrides = [];
    await shared.report(a.showId, 1);
    expect(seg(a.env, 2).row).toMatchObject({ introStart: null, introSource: null, version: 0 });
    expect(seg(a.env, 1).row).toMatchObject({ manual: true, introStart: null, creditsStart: 200 });
    a.env.ctx.segments.enqueuePending();
    await a.env.ctx.segments.whenIdle();
    expect(Math.abs(seg(a.env, 2).row.introStart! - 35)).toBeLessThan(1.5);
    expect(seg(a.env, 2).row.introSource).toBe('audio');
  }, 120_000);
});

// ---- the logic on its own
const profile = (over: Partial<SharedProfile> = {}): SharedProfile => ({ tmdbShow: 1, season: 1, servers: 3, parts: [], mine: [], prints: [], ...over });
const part = (over: Partial<SharedProfile['parts'][number]> = {}) => ({ episode: 1, kind: 'intro' as const, duration: 2700, start: 60, end: 90, confirmations: 2, reports: 2, manual: false, ...over });

describe('shared detection: using what others agree on', () => {
  it('takes the Control Center\'s correction for the same cut only, and copes without any', () => {
    const p = profile({ overrides: [
      { episode: 1, kind: 'intro', duration: 2700, start: 50, end: 80 },
      { episode: 1, kind: 'intro', duration: 2701.5, start: 55, end: 85 },
      { episode: 1, kind: 'credits', duration: 2760, start: 2600, end: 2700 },
    ] });
    expect(overridesFor(p, 1, 2701)).toEqual({ intro: { start: 55, end: 85 } });
    expect(overridesFor(p, 1, 2699)).toEqual({ intro: { start: 50, end: 80 } });
    expect(overridesFor(p, 2, 2700)).toEqual({});
    // An older vidalune.com sends no corrections.
    expect(overridesFor(profile(), 1, 2700)).toEqual({});
  });

  it('asks vidalune.com again every six hours', () => {
    expect(PROFILE_FRESH_MS).toBe(6 * 3_600_000);
    expect(SHARED_SYNC_MS).toBe(6 * 3_600_000);
  });

  it('only takes parts two servers (or a correction by hand) agree on, for the same cut', () => {
    expect(sharedFor(profile({ parts: [part({ confirmations: 1 })] }), 1, 2700)).toEqual({});
    expect(sharedFor(profile({ parts: [part()] }), 1, 2700).intro).toMatchObject({ confidence: 'medium' });
    expect(sharedFor(profile({ parts: [part({ confirmations: 3 })] }), 1, 2701.5).intro).toMatchObject({ confidence: 'high' });
    expect(sharedFor(profile({ parts: [part({ confirmations: 1, manual: true })] }), 1, 2700).intro).toMatchObject({ confidence: 'high' });
    expect(sharedFor(profile({ parts: [part()] }), 1, 2760)).toEqual({});
    expect(sharedFor(profile({ parts: [part()] }), 2, 2700)).toEqual({});
    // Two cuts reported: the better backed one.
    expect(sharedFor(profile({ parts: [part(), part({ start: 70, end: 100, confirmations: 4, duration: 2701 })] }), 1, 2700).intro).toMatchObject({ start: 70 });
  });

  it('labels a result by how many servers agree', () => {
    const p = profile({ parts: [part({ confirmations: 1 }), part({ kind: 'credits', start: 2600, end: 2700, confirmations: 3 }), part({ episode: 2, confirmations: 2 })] });
    expect(shareState(p, 1, 2700, 'intro', 60.5, 89)).toBe('pending');
    expect(shareState(p, 1, 2700, 'credits', 2601, 2700)).toBe('verified');
    expect(shareState(p, 2, 2700, 'intro', 60, 90)).toBe('shared');
    // Found somewhere else than the others: not backed up.
    expect(shareState(p, 2, 2700, 'intro', 120, 150)).toBe('pending');
    expect(weakest(['verified', 'shared'])).toBe('shared');
    expect(weakest([])).toBeNull();
  });

  it('turns others’ fingerprints into references (a few, and only sensible ones)', () => {
    const words = (n: number) => Buffer.from(new Uint32Array(n).fill(7).buffer).toString('base64');
    const refs = sharedReferences(profile({ prints: [...Array.from({ length: 5 }, () => ({ kind: 'intro' as const, words: words(300) })), { kind: 'credits', words: words(3) }] }));
    expect(refs.intro).toHaveLength(3);
    expect(refs.intro[0].words.length).toBe(300);
    expect(refs.credits).toHaveLength(0);
    expect(sharedReferences(null)).toEqual({ intro: [], credits: [] });
  });

  it('uses the last profile it had when vidalune.com cannot be reached', async () => {
    const env = await createTestEnv();
    envs.push(env);
    const lib = await setupAdmin(env.app).then(() => env.ctx.db.$client.prepare("INSERT INTO libraries (name, type, path) VALUES ('tv', 'shows', '/x')").run());
    env.ctx.db.$client.prepare("INSERT INTO shows (library_id, group_key, title, sort_title, parsed_title, tmdb_id) VALUES (?, 'x', 'X', 'x', 'X', 77)").run(lib.lastInsertRowid);
    const showId = env.ctx.db.select().from(shows).get()!.id;
    let up = true;
    let calls = 0;
    let clock = 1_000_000;
    const shared = new SharedDetection(
      env.ctx.db,
      {
        registered: () => true,
        detectionProfile: async <T,>() => {
          calls++;
          if (!up) throw new Error('unreachable');
          return profile({ tmdbShow: 77, parts: [part()] }) as T;
        },
        reportDetection: async <T,>() => profile() as T,
      },
      () => true,
      () => clock,
    );
    expect((await shared.profile(showId, 1))?.parts).toHaveLength(1);
    expect(env.ctx.db.select().from(sharedDetectionCache).all()).toHaveLength(1);
    // Fresh: not asked again.
    await shared.profile(showId, 1);
    expect(calls).toBe(1);
    // Five hours on: still fresh.
    clock += 5 * 3_600_000;
    await shared.profile(showId, 1);
    expect(calls).toBe(1);
    // Over six hours on, unreachable: the kept one.
    clock += 2 * 3_600_000;
    up = false;
    expect((await shared.profile(showId, 1))?.parts).toHaveLength(1);
    expect(calls).toBe(2);
    // A show without a TMDB id is never shared.
    env.ctx.db.update(shows).set({ tmdbId: null }).run();
    expect(await shared.profile(showId, 1)).toBeNull();
  });
});
