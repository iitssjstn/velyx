import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { machineBusy } from '../src/app.js';
import { encodeArgs } from '../src/playback/transcode.js';
import { OptimizationService, OPTIMIZATION_PROFILES, optimizationArgs, optimizationThreads, type OptimizationProfile } from '../src/services/optimization.js';
import { mediaFiles, optimizedMedia } from '../src/db/schema.js';
import { OptimizationCheckpoint } from '../src/services/optimization-checkpoint.js';
import { limitProber } from '../src/services/probe-queue.js';
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
      expect(args).toContain(`scale=w='min(iw,${dimensions.width})':h='min(ih,${dimensions.height})':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`);
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

  it('can resume at a checkpoint and write independently playable segments', () => {
    const args = optimizationArgs({ profile: 'compat-720p', input: '/in.mkv', output: '/parts/part-%06d.ts', video: encodeArgs('software'), startSec: 120, segment: { list: '/parts/active.csv', startNumber: 2, seconds: 60 } });
    expect(args[args.indexOf('-ss') + 1]).toBe('119.999000');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-segment_start_number') + 1]).toBe('2');
    expect(args[args.indexOf('-segment_format') + 1]).toBe('mpegts');
    expect(args).not.toContain('+faststart');
  });

  it('seeks before a rounded NTSC checkpoint rather than skipping its next frame', () => {
    const args = optimizationArgs({ profile: 'compat-720p', input: '/in.mkv', output: '/out.ts', video: encodeArgs('software'), startSec: 1.001011 });
    expect(args[args.indexOf('-ss') + 1]).toBe('1.000011');
    const nearStart = optimizationArgs({ profile: 'compat-720p', input: '/in.mkv', output: '/out.ts', video: encodeArgs('software'), startSec: 0.0005 });
    expect(nearStart[nearStart.indexOf('-ss') + 1]).toBe('0.000000');
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

  it('preserves completed checkpoints across restarts and discards the unfinished segment', () => {
    const output = path.join(env.dir, 'checkpoint.mp4');
    const options = { sourceSize: 100, sourceMtimeMs: 10, durationSec: 180, video: encodeArgs('software') };
    const checkpoint = new OptimizationCheckpoint(output, options);
    checkpoint.prepare();
    touch(path.join(checkpoint.directory, 'part-000000.ts'));
    touch(path.join(checkpoint.directory, 'part-000001.ts'));
    fs.writeFileSync(checkpoint.list, 'part-000000.ts,0,60\npart-000001.ts,60,80\n');
    checkpoint.capture(false);
    expect(checkpoint.offset).toBe(60);
    const restored = new OptimizationCheckpoint(output, options);
    expect(restored.offset).toBe(60);
    restored.prepare();
    expect(fs.existsSync(path.join(restored.directory, 'part-000001.ts'))).toBe(false);
    expect(fs.existsSync(path.join(restored.directory, 'part-000000.ts'))).toBe(true);
    expect(restored.nextIndex).toBe(1);
    fs.writeFileSync(restored.list, 'part-000001.ts,0,60\n');
    touch(path.join(restored.directory, 'part-000001.ts'));
    restored.capture(false);
    expect(restored.offset).toBe(120);
    expect(new OptimizationCheckpoint(output, { ...options, sourceMtimeMs: 11 }).offset).toBe(0);
  });

  it('remembers completed encoding across restart even when container duration includes an audio tail', () => {
    const output = path.join(env.dir, 'completed.mp4');
    const options = { sourceSize: 100, sourceMtimeMs: 10, durationSec: 120.032, video: encodeArgs('software') };
    const checkpoint = new OptimizationCheckpoint(output, options);
    checkpoint.prepare();
    touch(path.join(checkpoint.directory, 'part-000000.ts'));
    touch(path.join(checkpoint.directory, 'part-000001.ts'));
    fs.writeFileSync(checkpoint.list, 'part-000000.ts,0,60\npart-000001.ts,60,120\n');
    checkpoint.capture(true);
    expect(checkpoint.complete).toBe(true);
    expect(new OptimizationCheckpoint(output, options).complete).toBe(true);
    fs.rmSync(path.join(checkpoint.directory, 'part-000001.ts'));
    expect(new OptimizationCheckpoint(output, options).complete).toBe(false);
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

  it('allows only admins to stop and resume a queued task, keeping its progress', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    touch(path.join(env.mediaDir, 'Movies', 'Queued Film.mkv'));
    await addLibrary(env, admin, 'movies', 'Movies');
    await env.ctx.optimizations.stop();
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    const queued = env.ctx.optimizations.queue(file.id, 'compat-720p');
    env.ctx.db.update(optimizedMedia).set({ progress: 50 }).where(eq(optimizedMedia.id, queued.id)).run();
    const stopUrl = `/api/admin/optimizations/${queued.id}/stop`;
    expect((await env.app.inject({ method: 'POST', url: stopUrl, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: stopUrl, headers: { cookie: admin } })).statusCode).toBe(200);
    expect(env.ctx.optimizations.list(file.id)[0]).toMatchObject({ status: 'paused', progress: 50 });
    expect((await env.app.inject({ method: 'POST', url: `/api/admin/media/${file.id}/optimizations`, headers: { cookie: admin }, payload: { profile: 'compat-720p' } })).json().variant).toMatchObject({ status: 'queued', progress: 50 });
    expect((await env.app.inject({ method: 'POST', url: '/api/admin/optimizations/invalid/stop', headers: { cookie: admin } })).statusCode).toBe(400);
    expect((await env.app.inject({ method: 'POST', url: '/api/admin/optimizations/99999/stop', headers: { cookie: admin } })).statusCode).toBe(404);
  });

  it('stops a task during encoder detection and does not restart manually stopped tasks', async () => {
    touch(path.join(env.mediaDir, 'Movies', 'Stop Film.mkv'));
    await addLibrary(env, admin, 'movies', 'Movies');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    let finishDetection!: (support: { software: boolean; vaapi: null; nvenc: boolean; checkedAt: number }) => void;
    env.ctx.transcoding.support = null;
    const detection = vi.spyOn(env.ctx.transcoding, 'detect').mockImplementation(() => new Promise((resolve) => { finishDetection = resolve; }));
    try {
      const queued = env.ctx.optimizations.queue(file.id, 'compat-720p');
      await vi.waitFor(() => expect(detection).toHaveBeenCalled());
      const stopping = env.ctx.optimizations.pause(queued.id);
      expect(() => env.ctx.optimizations.remove(queued.id)).toThrow(/Wait for optimization/);
      expect(() => env.ctx.optimizations.queue(file.id, 'compat-720p')).toThrow(/Wait for optimization/);
      finishDetection({ software: true, vaapi: null, nvenc: false, checkedAt: 0 });
      await stopping;
      expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('paused');
      await env.ctx.optimizations.stop();
      env.ctx.optimizations = new OptimizationService({ db: env.ctx.db, dataDir: env.ctx.config.dataDir, ffmpegPath: env.ctx.config.ffmpegPath, probe: limitProber(async () => fakeProbe(), 1), transcoding: env.ctx.transcoding, settings: env.ctx.settings, busy: () => true });
      expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('paused');
      expect(env.ctx.optimizations.overview().items[0]?.position).toBeNull();
    } finally {
      detection.mockRestore();
    }
  });

  it('requeues interrupted work on restart without deleting its checkpoints or resetting progress', async () => {
    touch(path.join(env.mediaDir, 'Movies', 'Restart Film.mkv'));
    await addLibrary(env, admin, 'movies', 'Movies');
    await env.ctx.optimizations.stop();
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    env.ctx.db.update(mediaFiles).set({ durationSec: 120 }).where(eq(mediaFiles.id, file.id)).run();
    const task = env.ctx.optimizations.queue(file.id, 'compat-720p');
    const row = env.ctx.db.select().from(optimizedMedia).get()!;
    const checkpoint = new OptimizationCheckpoint(row.outputPath, { sourceSize: file.size, sourceMtimeMs: file.mtimeMs, durationSec: 120, video: encodeArgs('software') });
    checkpoint.prepare();
    touch(path.join(checkpoint.directory, 'part-000000.ts'));
    fs.writeFileSync(checkpoint.list, 'part-000000.ts,0,60\n');
    checkpoint.capture(false);
    env.ctx.db.update(optimizedMedia).set({ status: 'processing', progress: 50 }).where(eq(optimizedMedia.id, task.id)).run();
    env.ctx.optimizations = new OptimizationService({ db: env.ctx.db, dataDir: env.ctx.config.dataDir, ffmpegPath: env.ctx.config.ffmpegPath, probe: limitProber(async () => fakeProbe(), 1), transcoding: env.ctx.transcoding, settings: env.ctx.settings, busy: () => true });
    expect(env.ctx.optimizations.list(file.id)[0]).toMatchObject({ status: 'queued', progress: 50 });
    expect(fs.existsSync(path.join(checkpoint.directory, 'part-000000.ts'))).toBe(true);
    expect(new OptimizationCheckpoint(row.outputPath, { sourceSize: file.size, sourceMtimeMs: file.mtimeMs, durationSec: 120, video: encodeArgs('software') }).offset).toBe(60);
    env.ctx.optimizations.remove(task.id);
    expect(fs.existsSync(checkpoint.directory)).toBe(false);
  });

  it.each(['24', '24000/1001'])('resumes a real %s fps encode without losing frames', async (rate) => {
    const sourcePath = path.join(env.mediaDir, 'Movies', 'Resume Film.mkv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const source = spawnSync(env.ctx.config.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${rate}`, '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '4', '-shortest', '-c:v', 'mpeg2video', '-c:a', 'mp2', sourcePath], { encoding: 'utf8', timeout: 20_000 });
    expect(source.status, source.stderr).toBe(0);
    await addLibrary(env, admin, 'movies', 'Movies');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    env.ctx.db.update(mediaFiles).set({ durationSec: 4 }).where(eq(mediaFiles.id, file.id)).run();
    const output = path.join(env.ctx.optimizations.outputDir, String(file.id), 'compat-720p.mp4');
    const checkpoint = new OptimizationCheckpoint(output, { sourceSize: file.size, sourceMtimeMs: file.mtimeMs, durationSec: 4, video: encodeArgs('software'), segmentSeconds: 1 });
    checkpoint.prepare();
    const args = optimizationArgs({ profile: 'compat-720p', input: sourcePath, output: path.join(checkpoint.directory, 'part-%06d.ts'), video: checkpoint.video, segment: { list: checkpoint.list, startNumber: 0, seconds: 1 } });
    args.splice(args.length - 1, 0, '-t', '1.5');
    const part = spawnSync(env.ctx.config.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', ...args], { encoding: 'utf8', timeout: 20_000 });
    expect(part.status, part.stderr).toBe(0);
    checkpoint.capture(false);
    expect(checkpoint.nextIndex).toBe(1);
    const stateFile = path.join(checkpoint.directory, 'checkpoint.json');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { parts: { endSec: number }[] };
    saved.parts[0]!.endSec += 0.000001;
    fs.writeFileSync(stateFile, JSON.stringify(saved));
    const offset = saved.parts[0]!.endSec;
    const runner = env.ctx.optimizations as unknown as { runFfmpeg: (...args: unknown[]) => Promise<void> };
    const calls = vi.spyOn(runner, 'runFfmpeg');
    try {
      env.ctx.optimizations.queue(file.id, 'compat-720p');
      await vi.waitFor(() => expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('ready'), { timeout: 30_000 });
      const encoding = calls.mock.calls.find((call) => (call[1] as string[]).includes('-segment_start_number'))![1] as string[];
      expect(encoding[encoding.indexOf('-ss') + 1]).toBe(Math.max(0, offset - 0.001).toFixed(6));
      expect(encoding[encoding.indexOf('-segment_start_number') + 1]).toBe('1');
      const probe = spawnSync(env.ctx.config.ffprobePath, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_name,duration,start_time,nb_read_frames', '-of', 'json', output], { encoding: 'utf8' });
      expect(probe.status, probe.stderr).toBe(0);
      const result = JSON.parse(probe.stdout) as { format: { duration: string }; streams: { codec_name: string; duration: string; start_time: string; nb_read_frames: string }[] };
      expect(Number(result.format.duration)).toBeGreaterThan(3.9);
      expect(Number(result.format.duration)).toBeLessThan(4.3);
      expect(Math.abs(Number(result.streams[0]!.duration) - Number(result.streams[1]!.duration))).toBeLessThan(0.15);
      const sourceProbe = spawnSync(env.ctx.config.ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', sourcePath], { encoding: 'utf8' });
      expect(sourceProbe.status, sourceProbe.stderr).toBe(0);
      const original = JSON.parse(sourceProbe.stdout) as { streams: { nb_read_frames: string }[] };
      expect(Number(result.streams[0]!.nb_read_frames), `resume offset=${offset}`).toBe(Number(original.streams[0]!.nb_read_frames));
      expect(fs.existsSync(checkpoint.directory)).toBe(false);
    } finally {
      calls.mockRestore();
    }
  }, 40_000);

  it.each(['administrator', 'update'] as const)('preserves checkpoints when a running FFmpeg job is stopped by %s', async (reason) => {
    const sourcePath = path.join(env.mediaDir, 'Movies', 'Live stop.mkv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const source = spawnSync(env.ctx.config.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '4', '-shortest', '-c:v', 'mpeg2video', '-c:a', 'mp2', sourcePath], { encoding: 'utf8', timeout: 20_000 });
    expect(source.status, source.stderr).toBe(0);
    await addLibrary(env, admin, 'movies', 'Movies');
    const file = env.ctx.db.select().from(mediaFiles).get()!;
    env.ctx.db.update(mediaFiles).set({ durationSec: 4 }).where(eq(mediaFiles.id, file.id)).run();
    const output = path.join(env.ctx.optimizations.outputDir, String(file.id), 'compat-720p.mp4');
    const options = { sourceSize: file.size, sourceMtimeMs: file.mtimeMs, durationSec: 4, video: encodeArgs('software'), segmentSeconds: 1 };
    new OptimizationCheckpoint(output, options);
    const worker = env.ctx.optimizations as unknown as { runFfmpeg(id: number, args: string[], duration: number, threads: number, start?: number, checkpoint?: () => void, cwd?: string): Promise<void> };
    const original = worker.runFfmpeg.bind(worker);
    const runner = vi.spyOn(worker, 'runFfmpeg').mockImplementation((id, args, ...rest) => original(id, args.includes('-segment_start_number') ? ['-re', ...args] : args, ...rest));
    try {
      const task = env.ctx.optimizations.queue(file.id, 'compat-720p');
      await vi.waitFor(() => {
        const saved = JSON.parse(fs.readFileSync(path.join(`${output}.parts`, 'checkpoint.json'), 'utf8')) as { parts: unknown[] };
        expect(saved.parts.length).toBeGreaterThan(0);
        expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('processing');
      }, { timeout: 15_000 });
      if (reason === 'administrator') {
        const result = await env.app.inject({ method: 'POST', url: `/api/admin/optimizations/${task.id}/stop`, headers: { cookie: admin } });
        expect(result.statusCode).toBe(200);
      } else await env.ctx.optimizations.stop();
      const stopped = env.ctx.optimizations.list(file.id)[0]!;
      expect(stopped.status).toBe(reason === 'administrator' ? 'paused' : 'queued');
      expect(stopped.progress).toBeGreaterThan(0);
      expect(stopped.progress).toBeLessThan(100);
      await env.ctx.optimizations.stop();
      const offset = new OptimizationCheckpoint(output, options).offset;
      expect(offset).toBeGreaterThan(0);
      env.ctx.optimizations = new OptimizationService({ db: env.ctx.db, dataDir: env.ctx.config.dataDir, ffmpegPath: env.ctx.config.ffmpegPath, probe: limitProber(async () => fakeProbe({ container: 'mp4', durationSec: 4 }), 1), transcoding: env.ctx.transcoding, settings: env.ctx.settings, busy: () => false });
      if (reason === 'administrator') {
        expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('paused');
        env.ctx.optimizations.queue(file.id, 'compat-720p');
      }
      await vi.waitFor(() => expect(env.ctx.optimizations.list(file.id)[0]?.status).toBe('ready'), { timeout: 15_000 });
      expect(fs.existsSync(output)).toBe(true);
      expect(fs.existsSync(`${output}.parts`)).toBe(false);
    } finally {
      runner.mockRestore();
    }
  }, 40_000);

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
    expect(status, env.ctx.optimizations.list(file.id)[0]!.error ?? undefined).toBe('ready');
    const output = env.ctx.db.select().from(optimizedMedia).get()!;
    const probe = spawnSync(env.ctx.config.ffprobePath, [
      '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', output.outputPath,
    ], { encoding: 'utf8', timeout: 10_000 });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout).toContain('h264');
    expect(probe.stdout).toContain('aac');
  }, 40_000);
});