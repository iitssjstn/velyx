import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles } from '../src/db/schema.js';
import { EmbeddedSubtitleExtractor, isStopped, StoppedError } from '../src/services/subtitles.js';
import { needsKeyframes, SubtitlePrefetcher, type KeyframeStore, type PrefetchHooks } from '../src/services/subtitle-prefetch.js';
import { KeyframesStopped } from '../src/playback/hls.js';
import type { SubtitleTrackInfo } from '../src/db/schema.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const track = (index: number, language: string, textBased = true): SubtitleTrackInfo => ({ index, codec: textBased ? 'subrip' : 'hdmv_pgs_subtitle', language, title: null, isDefault: false, isForced: false, textBased });

/** A three-second MKV with a Dutch (stream 1) and an English (stream 2) SubRip subtitle. */
function subtitledMovie(dir: string): string {
  fs.writeFileSync(path.join(dir, 'nl.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHallo\n\n');
  fs.writeFileSync(path.join(dir, 'en.srt'), '1\n00:00:01,500 --> 00:00:02,500\nHello\n\n');
  const out = path.join(dir, 'movie.mkv');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10:duration=3', '-i', path.join(dir, 'nl.srt'), '-i', path.join(dir, 'en.srt'), '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-c:s', 'srt', out]);
  return out;
}

describe.skipIf(!hasFfmpeg)('embedded subtitle extraction', () => {
  let dir: string;
  let cache: string;
  let movie: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-subs-'));
    cache = path.join(dir, 'cache');
    movie = subtitledMovie(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes the other text subtitles in the same read as the one asked for', async () => {
    const x = new EmbeddedSubtitleExtractor('ffmpeg', cache);
    const vtt = await x.extract(7, 1000, movie, 1, { also: [1, 2] });
    expect(vtt).toContain('Hallo');
    expect(x.isCached(7, 1000, 2)).toBe(true);
    expect(await x.extract(7, 1000, movie, 2)).toContain('Hello');
    expect(fs.readdirSync(cache).sort()).toEqual(['7-1-1000.vtt', '7-2-1000.vtt']);
  });

  it('extracts every listed subtitle ahead of time, and only once', async () => {
    const x = new EmbeddedSubtitleExtractor('ffmpeg', cache);
    await x.extractAll(7, 1000, movie, [1, 2]);
    expect(x.isCached(7, 1000, 1) && x.isCached(7, 1000, 2)).toBe(true);
    // A changed file (other modification time) is extracted again.
    expect(x.isCached(7, 2000, 1)).toBe(false);
  });

  it('stops a background read when asked, leaving nothing half written', async () => {
    const x = new EmbeddedSubtitleExtractor('ffmpeg', cache);
    const controller = new AbortController();
    const run = x.extractAll(7, 1000, movie, [1, 2], { signal: controller.signal });
    controller.abort();
    const err = await run.catch((e: unknown) => e);
    expect(isStopped(err)).toBe(true);
    expect(fs.existsSync(cache) ? fs.readdirSync(cache) : []).toEqual([]);
  });

  it('reads a subtitle again for a viewer who asks just as the background read stops', async () => {
    const x = new EmbeddedSubtitleExtractor('ffmpeg', cache);
    const controller = new AbortController();
    const background = x.extractAll(7, 1000, movie, [2], { signal: controller.signal });
    controller.abort();
    const viewer = x.extract(7, 1000, movie, 2);
    expect(isStopped(await background.catch((e: unknown) => e))).toBe(true);
    expect(await viewer).toContain('Hello');
  });

  it('keeps a background read going once a viewer waits for one of its subtitles', async () => {
    const x = new EmbeddedSubtitleExtractor('ffmpeg', cache);
    const controller = new AbortController();
    const background = x.extractAll(7, 1000, movie, [1, 2], { signal: controller.signal });
    const viewer = x.extract(7, 1000, movie, 2);
    controller.abort();
    expect(await viewer).toContain('Hello');
    await background;
    expect(x.isCached(7, 1000, 1)).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)('subtitle requests', () => {
  it('extract the other text subtitles of the file in the same read', async () => {
    const env = await createTestEnv({ prober: async () => fakeProbe({ container: 'mkv', subtitleTracks: [track(1, 'nld'), track(2, 'eng')] }) });
    try {
      const admin = await setupAdmin(env.app);
      fs.mkdirSync(path.join(env.mediaDir, 'movies'), { recursive: true });
      fs.copyFileSync(subtitledMovie(env.dir), path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
      await addLibrary(env, admin, 'movies', 'movies');
      const file = env.ctx.db.select().from(mediaFiles).get()!;
      const res = await env.app.inject({ url: `/api/media/${file.id}/subtitles/1.vtt`, headers: { cookie: admin } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Hallo');
      expect(env.ctx.subtitleExtractor.isCached(file.id, file.mtimeMs, 2)).toBe(true);
    } finally {
      await env.cleanup();
    }
  });
});

describe('subtitle prefetcher', () => {
  let env: TestEnv;
  let admin: string;
  let clock: number;
  let busy: 'playback' | 'scan' | null;
  let enabled: boolean;
  let inWindow: boolean;
  let outside: boolean;
  const calls: Array<{ fileId: number; indexes: number[] }> = [];
  const cached = new Set<string>();
  let holdNext = false;
  let failNext = false;

  const extractor = {
    isCached: (fileId: number, _mtime: number, index: number) => cached.has(`${fileId}-${index}`),
    extractAll: async (fileId: number, _mtime: number, _path: string, indexes: number[], options: { signal?: AbortSignal } = {}) => {
      calls.push({ fileId, indexes });
      if (failNext) {
        failNext = false;
        throw new Error('broken subtitle');
      }
      if (holdNext) {
        holdNext = false;
        // Reads until stopped, like a big file on a slow disk.
        await new Promise<void>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new StoppedError())));
      }
      for (const i of indexes) cached.add(`${fileId}-${i}`);
    },
  };

  const hooks = (over: Partial<PrefetchHooks> = {}): PrefetchHooks => ({ enabled: () => enabled, busy: () => busy, inWindow: () => inWindow, outsideWindow: () => outside, quietMs: 15 * 60_000, checkMs: 5, now: () => clock, ...over });

  beforeEach(async () => {
    const tracks: Record<string, SubtitleTrackInfo[]> = {
      'Heat (1995).mkv': [track(2, 'nld'), track(3, 'eng'), track(4, 'eng', false)],
      'Arrival (2016).mkv': [track(2, 'eng')],
      'Dune (2021).mkv': [track(2, 'eng', false)],
    };
    env = await createTestEnv({ prober: async (file) => fakeProbe({ container: 'mkv', subtitleTracks: tracks[path.basename(file)] ?? [] }) });
    admin = await setupAdmin(env.app);
    for (const name of Object.keys(tracks)) touch(path.join(env.mediaDir, 'movies', name));
    await addLibrary(env, admin, 'movies', 'movies');
    // Heat was added last: newest first.
    const heat = env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.path, path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'))).get()!;
    env.ctx.db.update(mediaFiles).set({ addedAt: Date.now() + 1000 }).where(eq(mediaFiles.id, heat.id)).run();
    clock = 1_000_000;
    busy = null;
    enabled = true;
    inWindow = false;
    outside = true;
    calls.length = 0;
    cached.clear();
    holdNext = false;
    failNext = false;
  });
  afterEach(() => env.cleanup());

  const fileId = (name: string) => env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.path, path.join(env.mediaDir, 'movies', name))).get()!.id;

  it('waits until nobody has watched for a while, then extracts the text subtitles, newest file first', async () => {
    busy = 'playback';
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks());
    expect(await p.step()).toBe('playback');
    busy = null;
    clock += 10 * 60_000;
    expect(await p.step()).toBe('quiet');
    clock += 5 * 60_000;
    expect(p.status()).toMatchObject({ enabled: true, pending: 2 });
    expect(await p.step()).toBe('done');
    expect(calls).toEqual([{ fileId: fileId('Heat (1995).mkv'), indexes: [2, 3] }]);
    expect(await p.step()).toBe('done');
    expect(calls[1]).toEqual({ fileId: fileId('Arrival (2016).mkv'), indexes: [2] });
    // Image subtitles (Dune) cannot be extracted to text: nothing left.
    expect(await p.step()).toBe('empty');
    expect(p.status().pending).toBe(0);
  });

  it('works in the maintenance window as soon as nobody watches, without waiting for quiet', async () => {
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks());
    busy = 'playback';
    inWindow = true;
    expect(await p.step()).toBe('playback');
    busy = null;
    expect(await p.step()).toBe('done');
  });

  it('works only in the window when working outside it is turned off, and stops when the window closes', async () => {
    outside = false;
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks({ quietMs: 0 }));
    expect(await p.step()).toBe('window');
    expect(p.status().waitingFor).toBe('window');
    inWindow = true;
    holdNext = true;
    const running = p.step();
    await new Promise((r) => setTimeout(r, 20));
    inWindow = false;
    expect(await running).toBe('stopped');
    expect(calls).toHaveLength(1);
  });

  it('does nothing while turned off or while a scan runs', async () => {
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks({ quietMs: 0 }));
    enabled = false;
    expect(await p.step()).toBe('off');
    enabled = true;
    busy = 'scan';
    expect(await p.step()).toBe('scan');
    expect(calls).toEqual([]);
  });

  it('stops the file it reads when someone starts watching, and reads it again once it is quiet', async () => {
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks({ quietMs: 0 }));
    holdNext = true;
    const running = p.step();
    await new Promise((r) => setTimeout(r, 20));
    expect(p.status().running).toBe(true);
    busy = 'playback';
    expect(await running).toBe('stopped');
    expect(p.status()).toMatchObject({ running: false, pending: 2 });
    busy = null;
    expect(await p.step()).toBe('done');
    expect(calls.map((c) => c.fileId)).toEqual([fileId('Heat (1995).mkv'), fileId('Heat (1995).mkv')]);
  });

  it('does not try a file again after it failed, until the file changes', async () => {
    const p = new SubtitlePrefetcher(env.ctx.db, extractor, hooks({ quietMs: 0 }));
    failNext = true;
    expect(await p.step()).toBe('failed');
    expect(await p.step()).toBe('done');
    expect(calls.map((c) => c.fileId)).toEqual([fileId('Heat (1995).mkv'), fileId('Arrival (2016).mkv')]);
    expect(await p.step()).toBe('empty');
    env.ctx.db.update(mediaFiles).set({ mtimeMs: 5 }).where(eq(mediaFiles.id, fileId('Heat (1995).mkv'))).run();
    expect(await p.step()).toBe('done');
    expect(calls.at(-1)?.fileId).toBe(fileId('Heat (1995).mkv'));
  });
});

describe('maintenance window settings', () => {
  it('are saved by an administrator, shown with the server time, and must be 24-hour times', async () => {
    const env = await createTestEnv();
    try {
      const admin = await setupAdmin(env.app);
      const put = (payload: object) => env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload });
      expect((await put({ maintenanceStart: '25:00' })).statusCode).toBe(400);
      const res = await put({ maintenanceStart: '23:30', maintenanceEnd: '05:00', maintenanceOutside: false });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ maintenanceStart: '23:30', maintenanceEnd: '05:00', maintenanceOutside: false, serverTime: expect.stringMatching(/^\d{2}:\d{2}$/) });
      expect(env.ctx.settings.get()).toMatchObject({ maintenanceStart: '23:30', maintenanceEnd: '05:00', maintenanceOutside: false });
    } finally {
      await env.cleanup();
    }
  });
});

describe('keyframes prepared ahead of time', () => {
  it('are needed for every file a browser cannot play as it is', () => {
    const f = (container: string, videoCodec: string, audioCodec: string | null) => ({ container, videoCodec, audioCodec, durationSec: 5400 });
    expect(needsKeyframes(f('mp4', 'h264', 'aac'))).toBe(false);
    expect(needsKeyframes(f('mkv', 'h264', 'aac'))).toBe(true);
    expect(needsKeyframes(f('mp4', 'h264', 'eac3'))).toBe(true);
    expect(needsKeyframes(f('mp4', 'hevc', 'aac'))).toBe(true);
    expect(needsKeyframes({ ...f('mkv', 'h264', 'dts'), durationSec: null })).toBe(false);
  });

  let env: TestEnv;
  afterEach(() => env?.cleanup());

  async function library() {
    const probes: Record<string, Parameters<typeof fakeProbe>[0]> = {
      'Heat (1995).mkv': { container: 'mkv', audioCodec: 'dts', subtitleTracks: [] },
      'Arrival (2016).mp4': { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', subtitleTracks: [] },
    };
    env = await createTestEnv({ prober: async (file) => fakeProbe({ durationSec: 5400, ...probes[path.basename(file)] }) });
    const admin = await setupAdmin(env.app);
    for (const name of Object.keys(probes)) touch(path.join(env.mediaDir, 'movies', name));
    await addLibrary(env, admin, 'movies', 'movies');
    return admin;
  }

  it('are found in the background for files that may play in pieces, stopped when someone watches, and not retried after a failure', async () => {
    await library();
    const learned: string[] = [];
    let mode: 'ok' | 'hold' | 'fail' = 'hold';
    const store: KeyframeStore = {
      ready: (key) => learned.includes(key),
      learn: async (key, _input, signal) => {
        if (mode === 'fail') throw new Error('unreadable');
        if (mode === 'hold') await new Promise<void>((_r, reject) => signal?.addEventListener('abort', () => reject(new KeyframesStopped())));
        learned.push(key);
      },
    };
    let busy: 'playback' | null = null;
    const p = new SubtitlePrefetcher(env.ctx.db, { isCached: () => true, extractAll: async () => undefined }, { enabled: () => true, busy: () => busy, inWindow: () => true, outsideWindow: () => true, checkMs: 5 }, store);
    expect(p.status().pending).toBe(1);
    const running = p.step();
    await new Promise((r) => setTimeout(r, 20));
    busy = 'playback';
    expect(await running).toBe('stopped');
    busy = null;
    mode = 'fail';
    expect(await p.step()).toBe('failed');
    expect(await p.step()).toBe('empty');
    // Only the MKV (DTS) needed keyframes; the MP4 with H.264 and AAC plays as it is everywhere.
    const heat = env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.path, path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'))).get()!;
    env.ctx.db.update(mediaFiles).set({ mtimeMs: heat.mtimeMs + 1000 }).where(eq(mediaFiles.id, heat.id)).run();
    mode = 'ok';
    expect(await p.step()).toBe('done');
    expect(learned).toEqual([`${heat.id}:${heat.size}:${heat.mtimeMs + 1000}`]);
  });

  it('let the website play a repackaged file in pieces once they are known', async () => {
    const admin = await library();
    const heat = env.ctx.db.select().from(mediaFiles).where(eq(mediaFiles.path, path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'))).get()!;
    const play = async () => (await env.app.inject({ method: 'POST', url: `/api/media/${heat.id}/playback`, headers: { cookie: admin }, payload: { containers: ['mp4', 'webm'], videoCodecs: ['h264'], audioCodecs: ['aac', 'mp3', 'opus'] } })).json();
    const before = await play();
    expect(before.decision).toMatchObject({ engine: 'remux', seek: 'restart' });
    expect(before.decision.hlsUrl).toBeUndefined();
    const ready = vi.spyOn(env.ctx.hls, 'ready').mockImplementation((key) => key === `${heat.id}:${heat.size}:${heat.mtimeMs}`);
    const after = await play();
    expect(after.decision.hlsUrl).toMatch(new RegExp(`^/api/media/${heat.id}/hls/index\\.m3u8\\?`));
    ready.mockRestore();
  });
});
