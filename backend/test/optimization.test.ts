import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { machineBusy } from '../src/app.js';
import { encodeArgs } from '../src/playback/transcode.js';
import { OPTIMIZATION_PROFILES, optimizationArgs, optimizationThreads, type OptimizationProfile } from '../src/services/optimization.js';
import { mediaFiles, optimizedMedia } from '../src/db/schema.js';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => env.cleanup());

describe('playback optimization profiles', () => {
  it.each(Object.entries(OPTIMIZATION_PROFILES) as [OptimizationProfile, (typeof OPTIMIZATION_PROFILES)[OptimizationProfile]][])(
    'builds a bounded compatible MP4 for %s',
    (profile, dimensions) => {
      const args = optimizationArgs({ profile, input: '/media/source.mkv', output: '/data/optimized/result.mp4', video: encodeArgs('software') });
      expect(args).toContain('/media/source.mkv');
      expect(args).toContain('/data/optimized/result.mp4');
      expect(args).toContain(`scale=w='min(iw,${dimensions.width})':h='min(ih,${dimensions.height})':force_original_aspect_ratio=decrease:force_divisible_by=2`);
      expect(args).toContain('libx264');
      expect(args).toContain('yuv420p');
      expect(args).toContain('aac');
      expect(args[args.indexOf('-maxrate') + 1]).toBe(dimensions.maxBitrate);
      expect(args).toContain('0:a?');
      expect(args).toContain('+faststart');
      expect(args[args.indexOf('-threads') + 1]).toBe(String(optimizationThreads()));
      expect(args[args.indexOf('-preset') + 1]).toBe('superfast');
      expect(args).toContain('-progress');
      expect(args).toContain('pipe:1');
      expect(args).not.toContain('-c:s');
    },
  );

  it('uses every core up to four unless told otherwise', () => {
    expect(optimizationThreads()).toBeGreaterThanOrEqual(1);
    expect(optimizationThreads()).toBeLessThanOrEqual(4);
    const args = optimizationArgs({ profile: 'compat-720p', input: '/in.mkv', output: '/out.mp4', video: encodeArgs('software'), threads: 2 });
    expect(args[args.indexOf('-threads') + 1]).toBe('2');
  });

  it('does not count the load of the copy itself when judging whether the machine is busy', () => {
    const cores = Math.max(1, os.cpus().length);
    const load = vi.spyOn(os, 'loadavg').mockReturnValue([cores * 0.8, 0, 0]);
    try {
      expect(machineBusy()).toBe(true);
      expect(machineBusy(cores * 0.8)).toBe(false);
    } finally {
      load.mockRestore();
    }
  });

  it('queues and removes a copy only for an administrator without exposing its data path', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    const sourcePath = path.join(env.mediaDir, 'Movies', 'A Film.mkv');
    touch(sourcePath);
    await addLibrary(env, admin, 'movies', 'Movies');
    const file = env.ctx.db.select().from(mediaFiles).get();
    expect(file).toBeDefined();
    env.ctx.optimizations.stop();

    const forbidden = await env.app.inject({ url: `/api/admin/media/${file!.id}/optimizations`, headers: { cookie: viewer.cookie } });
    expect(forbidden.statusCode).toBe(403);

    const queued = await env.app.inject({ method: 'POST', url: `/api/admin/media/${file!.id}/optimizations`, headers: { cookie: admin }, payload: { profile: 'compat-720p' } });
    expect(queued.statusCode).toBe(200);
    expect(queued.json().variant).toMatchObject({ profile: 'compat-720p', status: 'queued', progress: 0 });
    expect(queued.body).not.toContain(env.dir);
    const row = env.ctx.db.select().from(optimizedMedia).get();
    expect(row?.outputPath.startsWith(path.join(env.dir, 'data', 'optimized'))).toBe(true);

    const listed = await env.app.inject({ url: `/api/admin/media/${file!.id}/optimizations`, headers: { cookie: admin } });
    expect(listed.json().variants).toHaveLength(1);

    expect((await env.app.inject({ url: '/api/admin/optimizations', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    const queue = await env.app.inject({ url: '/api/admin/optimizations', headers: { cookie: admin } });
    expect(queue.statusCode).toBe(200);
    expect(queue.body).not.toContain(env.dir);
    expect(queue.json().paused).toBe(false);
    expect(queue.json().items).toHaveLength(1);
    expect(queue.json().items[0]).toMatchObject({ fileId: file!.id, profile: 'compat-720p', status: 'queued', movieId: file!.movieId, showId: null, season: null });
    expect(typeof queue.json().items[0].title).toBe('string');

    const removed = await env.app.inject({ method: 'DELETE', url: `/api/admin/optimizations/${queued.json().variant.id}`, headers: { cookie: admin } });
    expect(removed.json()).toEqual({ ok: true });
    expect(env.ctx.db.select().from(optimizedMedia).all()).toHaveLength(0);
  });

  it('automatically plays a ready compatible copy when the source needs video transcoding', async () => {
    const sourcePath = path.join(env.mediaDir, 'Movies', 'Needs conversion.avi');
    touch(sourcePath);
    await addLibrary(env, admin, 'movies', 'Movies');
    const source = env.ctx.db.select().from(mediaFiles).get()!;
    env.ctx.db.update(mediaFiles).set({ container: 'avi', videoCodec: 'mpeg2video' }).where(eq(mediaFiles.id, source.id)).run();
    const outputPath = path.join(env.dir, 'data', 'optimized', String(source.id), 'compat-720p.mp4');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'compatible copy');
    const now = Date.now();
    const variant = env.ctx.db.insert(optimizedMedia).values({
      mediaFileId: source.id,
      profile: 'compat-720p',
      status: 'ready',
      progress: 100,
      outputPath,
      sourceSize: source.size,
      sourceMtimeMs: source.mtimeMs,
      outputSize: Buffer.byteLength('compatible copy'),
      probeJson: JSON.stringify(fakeProbe({ container: 'mp4', videoCodec: 'h264', width: 1280, height: 720, audioCodec: 'aac' })),
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    const highResolutionPath = path.join(env.dir, 'data', 'optimized', String(source.id), 'compat-1080p.mp4');
    fs.writeFileSync(highResolutionPath, 'higher resolution copy');
    env.ctx.db.insert(optimizedMedia).values({
      mediaFileId: source.id,
      profile: 'compat-1080p',
      status: 'ready',
      progress: 100,
      outputPath: highResolutionPath,
      sourceSize: source.size,
      sourceMtimeMs: source.mtimeMs,
      outputSize: Buffer.byteLength('higher resolution copy'),
      probeJson: JSON.stringify(fakeProbe({ container: 'mp4', videoCodec: 'h264', width: 1920, height: 1080, audioCodec: 'aac' })),
      createdAt: now,
      updatedAt: now,
    }).run();
    fs.rmSync(sourcePath);

    const playback = await env.app.inject({
      method: 'POST',
      url: `/api/media/${source.id}/playback`,
      headers: { cookie: admin },
      payload: { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], tenBitCodecs: [], hdr: false },
    });
    expect(playback.statusCode).toBe(200);
    expect(playback.json().decision.optimized).toEqual({ id: variant.id, profile: 'compat-720p' });
    expect(playback.json().decision.engine).toBe('direct');
    expect(playback.json().decision.streamUrl).toBe(`/api/media/${source.id}/stream?optimized=${variant.id}`);
    expect(playback.json().file.id).toBe(source.id);
    const stream = await env.app.inject({ url: playback.json().decision.streamUrl, headers: { cookie: admin } });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toBe('compatible copy');
  });

  it('encodes a real short source into a seekable H.264/AAC MP4 copy', async () => {
    const sourcePath = path.join(env.mediaDir, 'Movies', 'Encode smoke test.mkv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const source = spawnSync(env.ctx.config.ffmpegPath, [
      '-hide_banner', '-nostdin', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
      '-t', '2', '-shortest', '-c:v', 'mpeg2video', '-c:a', 'mp2', sourcePath,
    ], { encoding: 'utf8', timeout: 20_000 });
    expect(source.status, source.stderr).toBe(0);
    await addLibrary(env, admin, 'movies', 'Movies');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    env.ctx.db.update(mediaFiles).set({ durationSec: 2 }).where(eq(mediaFiles.id, file.id)).run();
    const queued = env.ctx.optimizations.queue(file.id, 'compat-720p');
    const deadline = Date.now() + 30_000;
    let status = queued.status;
    while (status === 'queued' || status === 'processing') {
      if (Date.now() > deadline) throw new Error('Optimization did not finish in time.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = env.ctx.optimizations.list(file.id)[0]!.status;
    }
    expect(status).toBe('ready');
    const output = env.ctx.db.select().from(optimizedMedia).get()!;
    const probe = spawnSync(env.ctx.config.ffprobePath, [
      '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', output.outputPath,
    ], { encoding: 'utf8', timeout: 10_000 });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout).toContain('h264');
    expect(probe.stdout).toContain('aac');
  }, 40_000);
});