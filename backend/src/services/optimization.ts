import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { libraries, mediaFiles, optimizedMedia } from '../db/schema.js';
import { HttpError } from '../http-error.js';
import type { ProbeResult } from './probe.js';
import type { LimitedProber } from './probe-queue.js';
import { resolveMediaPath } from './paths.js';
import type { SettingsService } from './settings.js';
import { TranscodingService, pickEncoder } from '../playback/transcode.js';
import { encodeArgs } from '../playback/transcode.js';
import type { VideoEncode } from '../playback/remux.js';

export type OptimizationProfile = 'compat-720p' | 'compat-1080p';

export const OPTIMIZATION_PROFILES: Record<OptimizationProfile, { width: number; height: number; maxBitrate: string; maxBuffer: string }> = {
  'compat-720p': { width: 1280, height: 720, maxBitrate: '4M', maxBuffer: '8M' },
  'compat-1080p': { width: 1920, height: 1080, maxBitrate: '8M', maxBuffer: '16M' },
};

/** Builds a bounded H.264/AAC MP4 copy; it never writes beside the source file. */
export function optimizationArgs(options: {
  profile: OptimizationProfile;
  input: string;
  output: string;
  video: VideoEncode;
}): string[] {
  const { width, height, maxBitrate, maxBuffer } = OPTIMIZATION_PROFILES[options.profile];
  const scale = `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const output = [...options.video.output];
  const filterIndex = output.indexOf('-vf');
  if (filterIndex >= 0) output[filterIndex + 1] = `${scale},${output[filterIndex + 1]}`;
  else output.unshift('-vf', scale);
  for (const [option, value] of [['-b:v', maxBitrate], ['-maxrate', maxBitrate], ['-bufsize', maxBuffer]] as const) {
    const index = output.indexOf(option);
    if (index >= 0 && !(option === '-b:v' && output[index + 1] === '0')) output[index + 1] = value;
  }
  return [
    ...options.video.input,
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
    '-movflags', '+faststart',
    '-threads', '1',
    '-progress', 'pipe:1',
    '-nostats',
    '-f', 'mp4',
    options.output,
  ];
}

export type OptimizationStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'stale';

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

export class OptimizationService {
  readonly outputDir: string;
  private readonly waiting: number[] = [];
  private readonly queued = new Set<number>();
  private running = false;
  private activeTask: Promise<void> | null = null;
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
      busy: () => boolean;
    },
  ) {
    this.outputDir = path.join(deps.dataDir, 'optimized');
    fs.mkdirSync(this.outputDir, { recursive: true });
    deps.db.update(optimizedMedia).set({ status: 'queued', progress: 0, error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.status, 'processing')).run();
    this.cleanOrphans();
    const pending = deps.db.select({ id: optimizedMedia.id }).from(optimizedMedia).where(eq(optimizedMedia.status, 'queued')).orderBy(asc(optimizedMedia.createdAt)).all();
    for (const row of pending) this.enqueue(row.id);
  }

  list(mediaFileId: number): OptimizationView[] {
    const source = this.source(mediaFileId);
    return this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.mediaFileId, mediaFileId)).orderBy(asc(optimizedMedia.profile)).all().map((row) => this.view(row, source.file.size, source.file.mtimeMs));
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
    if (existing?.status === 'queued' || existing?.status === 'processing') return this.view(existing, source.file.size, source.file.mtimeMs);
    if (existing?.status === 'ready' && this.view(existing, source.file.size, source.file.mtimeMs).status === 'ready') return this.view(existing, source.file.size, source.file.mtimeMs);

    const outputPath = path.join(this.outputDir, String(mediaFileId), `${profile}.mp4`);
    const values = {
      mediaFileId,
      profile,
      status: 'queued' as const,
      progress: 0,
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
    if (row.status === 'processing') throw new HttpError(409, 'Wait for optimization to finish before removing this version.');
    this.queued.delete(row.id);
    const output = path.resolve(row.outputPath);
    if (output.startsWith(`${this.outputDir}${path.sep}`)) {
      fs.rmSync(output, { force: true });
      const parent = path.dirname(output);
      if (parent !== this.outputDir && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    }
    this.deps.db.delete(optimizedMedia).where(eq(optimizedMedia.id, variantId)).run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.child?.pid && process.platform !== 'win32') {
      try { process.kill(this.child.pid, 'SIGCONT'); } catch { /* Process may have exited. */ }
    }
    this.child?.kill('SIGTERM');
    await this.activeTask?.catch(() => undefined);
  }

  private source(mediaFileId: number) {
    const source = this.deps.db.select({ file: mediaFiles, root: libraries.path }).from(mediaFiles).innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId)).where(eq(mediaFiles.id, mediaFileId)).get();
    if (!source) throw new HttpError(404, 'Media file not found.');
    return source;
  }

  private cleanOrphans(): void {
    const known = new Set(this.deps.db.select({ path: optimizedMedia.outputPath }).from(optimizedMedia).all().map((row) => path.resolve(row.path)));
    const clean = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const current = path.join(dir, entry.name);
        if (entry.isDirectory()) {
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
    if (this.deps.busy()) {
      this.kick(10_000);
      return;
    }
    const id = this.waiting.shift()!;
    this.queued.delete(id);
    this.running = true;
    const task = this.process(id);
    this.activeTask = task;
    try {
      await task;
    } finally {
      this.activeTask = null;
      this.running = false;
      this.kick();
    }
  }

  private async process(id: number): Promise<void> {
    const row = this.deps.db.select().from(optimizedMedia).where(eq(optimizedMedia.id, id)).get();
    if (!row) return;
    const tempPath = `${row.outputPath}.${process.pid}.partial.mp4`;
    try {
      const source = this.source(row.mediaFileId);
      const input = resolveMediaPath(source.root, source.file.path);
      if (!input || source.file.size !== row.sourceSize || source.file.mtimeMs !== row.sourceMtimeMs) throw new Error('The source file changed or is no longer available. Rescan the library and try again.');
      const stat = fs.statSync(input);
      if (stat.size !== row.sourceSize || Math.floor(stat.mtimeMs) !== row.sourceMtimeMs) throw new Error('The source file changed. Rescan the library and try again.');
      this.assertFreeSpace(row.profile, source.file.durationSec ?? 0);
      fs.mkdirSync(path.dirname(row.outputPath), { recursive: true });
      fs.rmSync(tempPath, { force: true });
      this.deps.db.update(optimizedMedia).set({ status: 'processing', progress: 0, error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();

      const support = this.deps.transcoding.support ?? await this.deps.transcoding.detect();
      const preference = this.deps.settings.get().transcoding.encoder;
      const encoder = pickEncoder(preference, support) ?? pickEncoder('auto', support);
      if (!encoder) throw new Error('No working video encoder is available on this server.');
      const args = optimizationArgs({ profile: row.profile, input, output: tempPath, video: encodeArgs(encoder, support.vaapi) });
      await this.runFfmpeg(id, args, source.file.durationSec ?? 0);
      if (this.stopped) throw new Error('Optimization stopped while the server was shutting down.');
      const probe = await this.deps.probe(tempPath);
      if (this.stopped) throw new Error('Optimization stopped while the server was shutting down.');
      if (probe.videoCodec !== 'h264' || probe.container !== 'mp4') throw new Error('FFmpeg did not produce a compatible H.264 MP4 file.');
      const outputSize = fs.statSync(tempPath).size;
      fs.rmSync(row.outputPath, { force: true });
      fs.renameSync(tempPath, row.outputPath);
      this.deps.db.update(optimizedMedia).set({ status: 'ready', progress: 100, outputSize, probeJson: JSON.stringify(probe), error: null, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      const message = (error as Error).message.slice(0, 1000);
      this.deps.db.update(optimizedMedia).set({ status: this.stopped ? 'queued' : 'failed', progress: 0, error: this.stopped ? null : message, updatedAt: Date.now() }).where(eq(optimizedMedia.id, id)).run();
    } finally {
      this.child = null;
    }
  }

  private runFfmpeg(id: number, args: string[], durationSec: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.deps.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      child.stdin.end();
      if (child.pid) {
        try { os.setPriority(child.pid, 10); } catch { /* best effort */ }
      }
      let paused = false;
      const pauseWhileBusy = () => {
        if (process.platform === 'win32' || !child.pid) return;
        const busy = this.deps.busy();
        if (busy === paused) return;
        try {
          process.kill(child.pid, busy ? 'SIGSTOP' : 'SIGCONT');
          paused = busy;
        } catch {
          /* Process may have exited while status changed. */
        }
      };
      const pauseTimer = setInterval(pauseWhileBusy, 1000);
      pauseTimer.unref?.();
      let stdout = '';
      let stderr = '';
      let lastProgress = -1;
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
          const progress = Math.min(99, Math.max(0, Math.floor((micros / 1_000_000 / durationSec) * 100)));
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
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`));
      });
    });
  }
}