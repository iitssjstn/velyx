import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, libraries, mediaFiles, movies, optimizedMedia, shows } from '../db/schema.js';
import { HttpError } from '../http-error.js';
import type { ProbeResult } from './probe.js';
import type { LimitedProber } from './probe-queue.js';
import { resolveMediaPath } from './paths.js';
import type { SettingsService } from './settings.js';
import { TranscodingService, pickEncoder } from '../playback/transcode.js';
import { encodeArgs } from '../playback/transcode.js';
import type { VideoEncode } from '../playback/remux.js';
import { OptimizationCheckpoint } from './optimization-checkpoint.js';

export type OptimizationProfile = 'compat-720p' | 'compat-1080p';

export const OPTIMIZATION_PROFILES: Record<OptimizationProfile, { width: number; height: number; maxBitrate: string; maxBuffer: string }> = {
  'compat-720p': { width: 1280, height: 720, maxBitrate: '4M', maxBuffer: '8M' },
  'compat-1080p': { width: 1920, height: 1080, maxBitrate: '8M', maxBuffer: '16M' },
};

/** Encoding threads: every core up to four. */
export function optimizationThreads(): number {
  return Math.max(1, Math.min(4, os.availableParallelism()));
}

/** Builds a bounded H.264/AAC MP4 copy; it never writes beside the source file. */
export function optimizationArgs(options: {
  profile: OptimizationProfile;
  input: string;
  output: string;
  video: VideoEncode;
  threads?: number;
  startSec?: number;
  segment?: { list: string; startNumber: number; seconds: number };
}): string[] {
  const { width, height, maxBitrate, maxBuffer } = OPTIMIZATION_PROFILES[options.profile];
  const scale = `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`;
  const output = [...options.video.output];
  // superfast encodes about twice as fast as veryfast, for a slightly larger copy.
  const presetIndex = output.indexOf('-preset');
  if (presetIndex >= 0 && output[presetIndex + 1] === 'veryfast') output[presetIndex + 1] = 'superfast';
  const filterIndex = output.indexOf('-vf');
  if (filterIndex >= 0) output[filterIndex + 1] = `${scale},${output[filterIndex + 1]}`;
  else output.unshift('-vf', scale);
  for (const [option, value] of [['-b:v', maxBitrate], ['-maxrate', maxBitrate], ['-bufsize', maxBuffer]] as const) {
    const index = output.indexOf(option);
    if (index >= 0 && !(option === '-b:v' && output[index + 1] === '0')) output[index + 1] = value;
  }
  // CSV and container time bases can round a boundary past the next source frame.
  const seek = options.startSec ? Math.max(0, options.startSec - 0.001).toFixed(6) : null;
  return [
    ...options.video.input,
    ...(seek !== null ? ['-ss', seek] : []),
    '-i', options.input,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-map_metadata', '0',
    '-sn',
    '-dn',
    ...output,
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    ...(options.segment ? ['-bf', '0', '-avoid_negative_ts', 'disabled', '-force_key_frames', `expr:gte(t,n_forced*${options.segment.seconds})`] : ['-movflags', '+faststart']),
    '-threads', String(options.threads ?? optimizationThreads()),
    '-progress', 'pipe:1',
    '-nostats',
    ...(options.segment ? [
      '-f', 'segment', '-segment_format', 'mpegts',
      '-segment_time', String(options.segment.seconds), '-reset_timestamps', '1',
      '-segment_start_number', String(options.segment.startNumber),
      '-segment_list_type', 'csv', '-segment_list', options.segment.list,
    ] : ['-f', 'mp4']),
    options.output,
  ];
}

export type OptimizationStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'stale' | 'paused';

export interface OptimizationView {
  id: number;
  profile: OptimizationProfile;
  status: OptimizationStatus;
  progress: number;
  outputSize: number | null;
  error: string | null;
  updatedAt: number;
}

export interface ReadyOptimization extends OptimizationView {
  status: 'ready';
  outputPath: string;
  probe: ProbeResult;
}

/** One copy in the admin queue, with what it belongs to. */
export interface OptimizationQueueItem extends OptimizationView {
  fileId: number;
  /** 1 = next in line (only while queued). */
  position: number | null;
  movieId: number | null;
  showId: number | null;
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
}

export class OptimizationService {
  readonly outputDir: string;
  private readonly waiting: number[] = [];
  private readonly queued = new Set<number>();
  private running = false;
  /** The running conversion is on hold because someone is watching and the server is busy, or a scan runs. */
  private paused = false;
  private activeTask: Promise<void> | null = null;
  private activeId: number | null = null;
  private readonly pauseRequests = new Set<number>();
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;

  constructor(
    private readonly deps: {
      db: DB;
      dataDir: string;
      ffmpegPath: string;
      probe: LimitedProber;
      transcoding: TranscodingService;
      settings: SettingsService;
      /** `ownLoad`: processors this conversion itself keeps busy, so it does not count against itself. */
      busy: (ownLoad: number) => boolean;
    },
  ) {
    this.outputDir = path.join(deps.dataDir, 'optimized');
    fs.mkdirSync(this.outputDir, { recursive: true });
    deps.db.update(optimizedMedia).set({ status: 'queued', error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.status, 'processing')).run();
    this.cleanOrphans();
    const pending = deps.db.select({ id: optimizedMedia.id }).from(optimizedMedia).where(eq(optimizedMedia.status, 'queued')).orderBy(asc(optimizedMedia.createdAt)).all();
    for (const row of pending) this.enqueue(row.id);
  }

  list(mediaFileId: number): OptimizationView[] {
    const source = this.source(mediaFileId);
    return this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.mediaFileId, mediaFileId)).orderBy(asc(optimizedMedia.profile)).all().map((row) => this.view(row, source.file.size, source.file.mtimeMs));
  }

  /** Every copy of every title for the admin queue: running first, then waiting, failed, outdated and finished. */
  overview(): { paused: boolean; items: OptimizationQueueItem[] } {
    const rows = this.deps.db
      .select({
        variant: optimizedMedia,
        file: mediaFiles,
        movieTitle: movies.title,
        movieYear: movies.year,
        showId: episodes.showId,
        showTitle: shows.title,
        season: episodes.seasonNumber,
        episode: episodes.episodeNumber,
        episodeTitle: episodes.title,
      })
      .from(optimizedMedia)
      .innerJoin(mediaFiles, eq(mediaFiles.id, optimizedMedia.mediaFileId))
      .leftJoin(movies, eq(movies.id, mediaFiles.movieId))
      .leftJoin(episodes, eq(episodes.id, mediaFiles.episodeId))
      .leftJoin(shows, eq(shows.id, episodes.showId))
      .all();
    const items = rows.map((row): OptimizationQueueItem => {
      const view = this.view(row.variant, row.file.size, row.file.mtimeMs);
      const place = this.waiting.indexOf(row.variant.id);
      return {
        ...view,
        fileId: row.file.id,
        position: view.status === 'queued' && place >= 0 ? place + 1 : null,
        movieId: row.file.movieId,
        showId: row.showId,
        title: row.movieTitle ?? row.showTitle,
        year: row.movieYear,
        season: row.season,
        episode: row.episode,
        episodeTitle: row.episodeTitle,
      };
    });
    const rank: Record<OptimizationStatus, number> = { processing: 0, queued: 1, paused: 2, failed: 3, stale: 4, ready: 5 };
    items.sort((a, b) => rank[a.status] - rank[b.status] || (a.position ?? 0) - (b.position ?? 0) || b.updatedAt - a.updatedAt);
    return { paused: this.paused, items };
  }

  queue(mediaFileId: number, profile: OptimizationProfile): OptimizationView {
    const source = this.source(mediaFileId);
    if (!source.file.videoCodec) throw new HttpError(415, 'This file has no video track to optimize.');
    if (!source.file.durationSec || source.file.durationSec <= 0) throw new HttpError(409, 'The length of this file is not known yet. Scan it before optimizing.');
    const absolute = resolveMediaPath(source.root, source.file.path);
    if (!absolute) throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    }
    if (stat.size !== source.file.size || Math.floor(stat.mtimeMs) !== source.file.mtimeMs) throw new HttpError(409, 'The source file changed. Rescan the library before optimizing it.');

    const existing = this.deps.db.select().from(optimizedMedia).where(and(eq(optimizedMedia.mediaFileId, mediaFileId), eq(optimizedMedia.profile, profile))).get();
    if (existing && this.activeId === existing.id && this.pauseRequests.has(existing.id)) throw new HttpError(409, 'Wait for optimization to stop before resuming it.');
    if (existing?.status === 'queued' || existing?.status === 'processing') return this.view(existing, source.file.size, source.file.mtimeMs);
    if (existing?.status === 'ready' && this.view(existing, source.file.size, source.file.mtimeMs).status === 'ready') return this.view(existing, source.file.size, source.file.mtimeMs);

    const outputPath = path.join(this.outputDir, String(mediaFileId), `${profile}.mp4`);
    const values = {
      mediaFileId,
      profile,
      status: 'queued' as const,
      progress: existing && existing.sourceSize === source.file.size && existing.sourceMtimeMs === source.file.mtimeMs ? existing.progress : 0,
      outputPath,
      sourceSize: source.file.size,
      sourceMtimeMs: source.file.mtimeMs,
      outputSize: null,
      probeJson: null,
      error: null,
      updatedAt: Date.now(),
    };
    this.deps.db.insert(optimizedMedia).values(values).onConflictDoUpdate({
      target: [optimizedMedia.mediaFileId, optimizedMedia.profile],
      set: values,
    }).run();
    const row = this.deps.db.select().from(optimizedMedia).where(and(eq(optimizedMedia.mediaFileId, mediaFileId), eq(optimizedMedia.profile, profile))).get()!;
    this.pauseRequests.delete(row.id);
    this.enqueue(row.id);
    return this.view(row, source.file.size, source.file.mtimeMs);
  }

  findReady(mediaFileId: number, sourceSize: number, sourceMtimeMs: number): ReadyOptimization | null {
    return this.findReadyVariants(mediaFileId, sourceSize, sourceMtimeMs)[0] ?? null;
  }

  findReadyVariants(mediaFileId: number, sourceSize: number, sourceMtimeMs: number): ReadyOptimization[] {
    const rows = this.deps.db.select().from(optimizedMedia).where(and(eq(optimizedMedia.mediaFileId, mediaFileId), eq(optimizedMedia.status, 'ready'))).all();
    const preferred = rows.sort((a, b) => (a.profile === 'compat-720p' ? -1 : 1) - (b.profile === 'compat-720p' ? -1 : 1));
    const ready: ReadyOptimization[] = [];
    for (const row of preferred) {
      const view = this.view(row, sourceSize, sourceMtimeMs);
      if (view.status !== 'ready' || !row.probeJson) continue;
      try {
        ready.push({ ...view, status: 'ready', outputPath: row.outputPath, probe: JSON.parse(row.probeJson) as ProbeResult });
      } catch {
        this.deps.db.update(optimizedMedia).set({ status: 'failed', error: 'The optimized file metadata is invalid. Optimize this title again.', updatedAt: Date.now() }).where(eq(optimizedMedia.id, row.id)).run();
      }
    }
    return ready;
  }

  resolve(mediaFileId: number, variantId: number, sourceSize: number, sourceMtimeMs: number): ReadyOptimization {
    const row = this.deps.db.select().from(optimizedMedia).where(and(eq(optimizedMedia.id, variantId), eq(optimizedMedia.mediaFileId, mediaFileId))).get();
    if (!row) throw new HttpError(404, 'Optimized version not found.');
    if (!this.isManagedOutput(row.outputPath)) throw new HttpError(409, 'The optimized file path is invalid. Optimize this title again.');
    const view = this.view(row, sourceSize, sourceMtimeMs);
    if (view.status !== 'ready') throw new HttpError(409, 'The optimized version is not ready or its source has changed.');
    const parsed = row.probeJson ? JSON.parse(row.probeJson) as ProbeResult : null;
    if (!parsed) throw new HttpError(409, 'The optimized version metadata is missing. Optimize this title again.');
    return { ...view, status: 'ready', outputPath: row.outputPath, probe: parsed };
  }

  remove(variantId: number): void {
    const row = this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.id, variantId)).get();
    if (!row) throw new HttpError(404, 'Optimized version not found.');
    if (row.status === 'processing' || this.activeId === row.id) throw new HttpError(409, 'Wait for optimization to finish before removing this version.');
    this.queued.delete(row.id);
    const waitingIndex = this.waiting.indexOf(row.id);
    if (waitingIndex >= 0) this.waiting.splice(waitingIndex, 1);
    this.pauseRequests.delete(row.id);
    const output = path.resolve(row.outputPath);
    if (output.startsWith(`${this.outputDir}${path.sep}`)) {
      fs.rmSync(output, { force: true });
      fs.rmSync(`${output}.parts`, { recursive: true, force: true });
      const parent = path.dirname(output);
      if (parent !== this.outputDir && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    }
    this.deps.db.delete(optimizedMedia).where(eq(optimizedMedia.id, variantId)).run();
  }

  async pause(variantId: number): Promise<void> {
    const row = this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.id, variantId)).get();
    if (!row) throw new HttpError(404, 'Optimized version not found.');
    if (row.status !== 'queued' && row.status !== 'processing' && row.status !== 'paused') throw new HttpError(409, 'Only queued or running optimizations can be stopped.');
    this.pauseRequests.add(row.id);
    this.queued.delete(row.id);
    const index = this.waiting.indexOf(row.id);
    if (index >= 0) this.waiting.splice(index, 1);
    this.deps.db.update(optimizedMedia).set({ status: 'paused', error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.id, row.id)).run();
    if (this.activeId === row.id) {
      this.terminateChild();
      await this.activeTask;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.terminateChild();
    await this.activeTask?.catch(() => undefined);
  }

  private terminateChild(): void {
    const child = this.child;
    if (!child?.pid) return;
    if (process.platform !== 'win32') {
      try { process.kill(child.pid, 'SIGCONT'); } catch { /* Process may have exited. */ }
    }
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }

  private source(mediaFileId: number) {
    const source = this.deps.db.select({ file: mediaFiles, root: libraries.path }).from(mediaFiles).innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId)).where(eq(mediaFiles.id, mediaFileId)).get();
    if (!source) throw new HttpError(404, 'Media file not found.');
    return source;
  }

  private cleanOrphans(): void {
    const rows = this.deps.db.select({ path: optimizedMedia.outputPath, status: optimizedMedia.status }).from(optimizedMedia).all();
    const known = new Set(rows.map((row) => path.resolve(row.path)));
    const checkpoints = new Set(rows.filter((row) => row.status !== 'ready').map((row) => path.resolve(`${row.path}.parts`)));
    const clean = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const current = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (checkpoints.has(path.resolve(current))) continue;
          clean(current);
          if (fs.readdirSync(current).length === 0) fs.rmdirSync(current);
        } else if (!known.has(path.resolve(current))) fs.rmSync(current, { force: true });
      }
    };
    clean(this.outputDir);
  }

  private view(row: typeof optimizedMedia.$inferSelect, sourceSize: number, sourceMtimeMs: number): OptimizationView {
    let status: OptimizationStatus = row.status;
    let error = row.error;
    if (status === 'ready' && (!this.isManagedOutput(row.outputPath) || row.sourceSize !== sourceSize || row.sourceMtimeMs !== sourceMtimeMs || !fs.existsSync(row.outputPath))) {
      status = 'stale';
      error = 'The source file changed or the optimized copy is missing. Optimize it again.';
    }
    return { id: row.id, profile: row.profile, status, progress: row.progress, outputSize: row.outputSize, error, updatedAt: row.updatedAt };
  }

  private isManagedOutput(outputPath: string): boolean {
    const absolute = path.resolve(outputPath);
    return absolute.startsWith(`${this.outputDir}${path.sep}`);
  }

  private assertFreeSpace(profile: OptimizationProfile, durationSec: number): void {
    const { maxBitrate } = OPTIMIZATION_PROFILES[profile];
    const videoBitsPerSecond = Number.parseFloat(maxBitrate) * (maxBitrate.endsWith('M') ? 1_000_000 : 1_000);
    const requiredBytes = Math.ceil(((videoBitsPerSecond + 160_000) * durationSec) / 8 + 512 * 1024 ** 2);
    const { bavail, bsize } = fs.statfsSync(this.outputDir);
    const availableBytes = bavail * bsize;
    if (availableBytes < requiredBytes) {
      throw new Error('Not enough free space on the Vidalune data disk for this copy.');
    }
  }

  private enqueue(id: number): void {
    if (this.queued.has(id) || this.stopped) return;
    this.queued.add(id);
    this.waiting.push(id);
    this.kick();
  }

  private kick(delayMs = 0): void {
    if (this.stopped || this.running || this.timer || this.waiting.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
    this.timer.unref?.();
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped || this.waiting.length === 0) return;
    if (this.deps.busy(0)) {
      this.kick(10_000);
      return;
    }
    const id = this.waiting.shift()!;
    this.queued.delete(id);
    this.running = true;
    this.activeId = id;
    const task = this.process(id);
    this.activeTask = task;
    try {
      await task;
    } finally {
      this.activeTask = null;
      this.activeId = null;
      this.running = false;
      this.kick();
    }
  }

  private async process(id: number): Promise<void> {
    const row = this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.id, id)).get();
    if (!row) return;
    const tempPath = `${row.outputPath}.${process.pid}.partial.mp4`;
    let checkpoint: OptimizationCheckpoint | null = null;
    let durationSec = 0;
    const assertRunning = () => {
      if (this.stopped || this.pauseRequests.has(id)) throw new Error('Optimization interrupted.');
    };
    try {
      assertRunning();
      if (!this.isManagedOutput(row.outputPath)) throw new Error('Invalid optimization output path.');
      const source = this.source(row.mediaFileId);
      durationSec = source.file.durationSec ?? 0;
      const input = resolveMediaPath(source.root, source.file.path);
      if (!input || source.file.size !== row.sourceSize || source.file.mtimeMs !== row.sourceMtimeMs) throw new Error('The source file changed or is no longer available. Rescan the library and try again.');
      const stat = fs.statSync(input);
      if (stat.size !== row.sourceSize || Math.floor(stat.mtimeMs) !== row.sourceMtimeMs) throw new Error('The source file changed. Rescan the library and try again.');
      fs.mkdirSync(path.dirname(row.outputPath), { recursive: true });
      fs.rmSync(tempPath, { force: true });
      this.deps.db.update(optimizedMedia).set({ status: 'processing', error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();

      const support = this.deps.transcoding.support ?? await this.deps.transcoding.detect();
      const preference = this.deps.settings.get().transcoding.encoder;
      const encoder = pickEncoder(preference, support) ?? pickEncoder('auto', support);
      if (!encoder) throw new Error('No working video encoder is available on this server.');
      assertRunning();
      checkpoint = new OptimizationCheckpoint(row.outputPath, { sourceSize: row.sourceSize, sourceMtimeMs: row.sourceMtimeMs, durationSec, video: encodeArgs(encoder, support.vaapi) });
      this.deps.db.update(optimizedMedia).set({ progress: Math.min(99, Math.floor(checkpoint.offset / durationSec * 100)) }).where(eq(optimizedMedia.id, id)).run();
      this.assertFreeSpace(row.profile, durationSec + Math.max(0, durationSec - checkpoint.offset));
      const threads = optimizationThreads();
      if (!checkpoint.complete) {
        checkpoint.prepare();
        const args = optimizationArgs({ profile: row.profile, input, output: path.join(checkpoint.directory, 'part-%06d.ts'), video: checkpoint.video, threads, startSec: checkpoint.offset, segment: { list: checkpoint.list, startNumber: checkpoint.nextIndex, seconds: checkpoint.segmentSeconds } });
        await this.runFfmpeg(id, args, durationSec, threads, checkpoint.offset, () => checkpoint!.capture(false));
        checkpoint.capture(true);
      }
      assertRunning();
      if (!checkpoint.complete) throw new Error('FFmpeg did not finish all optimization segments.');
      await this.runFfmpeg(id, ['-f', 'concat', '-safe', '1', '-i', path.basename(checkpoint.concatList()), '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tempPath], 0, 1, 0, undefined, checkpoint.directory);
      assertRunning();
      const probe = await this.deps.probe(tempPath);
      assertRunning();
      if (probe.videoCodec !== 'h264' || probe.container !== 'mp4') throw new Error('FFmpeg did not produce a compatible H.264 MP4 file.');
      const outputSize = fs.statSync(tempPath).size;
      fs.rmSync(row.outputPath, { force: true });
      fs.renameSync(tempPath, row.outputPath);
      this.deps.db.update(optimizedMedia).set({ status: 'ready', progress: 100, outputSize, probeJson: JSON.stringify(probe), error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();
      fs.rmSync(checkpoint.directory, { recursive: true, force: true });
    } catch (error) {
      try { checkpoint?.capture(false); } catch { /* The last durable checkpoint remains usable. */ }
      fs.rmSync(tempPath, { force: true });
      const message = (error as Error).message.slice(0, 1000);
      const paused = this.pauseRequests.has(id);
      const progress = checkpoint && durationSec > 0 ? Math.min(99, Math.floor(checkpoint.offset / durationSec * 100)) : row.progress;
      this.deps.db.update(optimizedMedia).set({ status: paused ? 'paused' : this.stopped ? 'queued' : 'failed', progress, error: paused || this.stopped ? null : message, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();
    } finally {
      this.child = null;
      this.paused = false;
    }
  }

  private runFfmpeg(id: number, args: string[], durationSec: number, threads: number, startSec = 0, checkpoint?: () => void, cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.deps.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
      this.child = child;
      child.stdin.end();
      if (child.pid) {
        try { os.setPriority(child.pid, 10); } catch { /* best effort */ }
      }
      let paused = false;
      const pauseWhileBusy = () => {
        if (process.platform === 'win32' || !child.pid || this.stopped || this.pauseRequests.has(id)) return;
        const busy = this.deps.busy(paused ? 0 : threads);
        if (busy === paused) return;
        try {
          process.kill(child.pid, busy ? 'SIGSTOP' : 'SIGCONT');
          paused = busy;
          this.paused = busy;
        } catch {
          /* Process may have exited while status changed. */
        }
      };
      const pauseTimer = setInterval(pauseWhileBusy, 1000);
      pauseTimer.unref?.();
      let stdout = '';
      let stderr = '';
      let lastProgress = -1;
      let checkpointError: Error | null = null;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        const lines = stdout.split('\n');
        stdout = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue;
          const micros = Number(line.slice('out_time_us='.length));
          if (!Number.isFinite(micros) || durationSec <= 0) continue;
          if (checkpointError) return;
          try {
            checkpoint?.();
          } catch (error) {
            checkpointError = error instanceof Error ? error : new Error(String(error));
            this.terminateChild();
            return;
          }
          const progress = Math.min(99, Math.max(0, Math.floor(((startSec + micros / 1_000_000) / durationSec) * 100)));
          if (progress > lastProgress) {
            lastProgress = progress;
            this.deps.db.update(optimizedMedia).set({ progress, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();
          }
        }
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
      child.once('error', (error) => { clearInterval(pauseTimer); reject(error); });
      child.once('close', (code) => {
        clearInterval(pauseTimer);
        if (code === 0 && !checkpointError) resolve();
        else reject(checkpointError ?? new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`));
      });
    });
  }
}