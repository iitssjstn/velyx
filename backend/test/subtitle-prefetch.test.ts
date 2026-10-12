import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles } from '../src/db/schema.js';
import { EmbeddedSubtitleExtractor, isStopped, StoppedError } from '../src/services/subtitles.js';
import { SubtitlePrefetcher, type PrefetchHooks } from '../src/services/subtitle-prefetch.js';
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

  const hooks = (over: Partial<PrefetchHooks> = {}): PrefetchHooks => ({ enabled: () => enabled, busy: () => busy, quietMs: 15 * 60_000, checkMs: 5, now: () => clock, ...over });

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
