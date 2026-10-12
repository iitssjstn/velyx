import { desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { libraries, mediaFiles } from '../db/schema.js';
import { createLogger } from '../logger.js';
import { resolveMediaPath } from './paths.js';
import { isStopped, type EmbeddedSubtitleExtractor } from './subtitles.js';
import { keyframesKey, KeyframesStopped } from '../playback/hls.js';

const log = createLogger('subtitle-prefetch');

/** Outside the maintenance window the server has to be quiet this long (nobody watching, no scan) before work starts or resumes. */
const QUIET_MS = 15 * 60 * 1000;
/** How often a waiting or idle prefetcher looks again. */
const RETRY_MS = 60 * 1000;
/** How often a running extraction checks whether someone started watching. */
const CHECK_MS = 5 * 1000;

export type PrefetchWait = 'off' | 'playback' | 'scan' | 'window' | 'quiet';

export interface PrefetchHooks {
  enabled: () => boolean;
  /** What keeps it from running now. */
  busy: () => 'playback' | 'scan' | null;
  /** Inside the maintenance window it works as soon as nobody watches. */
  inWindow: () => boolean;
  /** Outside it only when this is on, after the server has been quiet for a while. */
  outsideWindow: () => boolean;
  quietMs?: number;
  retryMs?: number;
  checkMs?: number;
  now?: () => number;
}

/** Where a file's keyframes are kept (the HLS sessions). */
export interface KeyframeStore {
  ready: (key: string) => boolean;
  learn: (key: string, input: string, signal?: AbortSignal) => Promise<void>;
}

/**
 * Files every browser plays as they are (MP4 with H.264 and AAC/MP3) never need pieces; any other file
 * may be played in pieces (HLS), which needs its keyframes.
 */
export function needsKeyframes(f: { container: string | null; videoCodec: string | null; audioCodec: string | null; durationSec: number | null }): boolean {
  if (!f.videoCodec || !f.durationSec) return false;
  const plain = ['mp4', 'm4v', 'mov'].includes(f.container ?? '') && f.videoCodec === 'h264' && (!f.audioCodec || ['aac', 'mp3'].includes(f.audioCodec));
  return !plain;
}

export interface PrefetchStatus {
  enabled: boolean;
  /** Files whose text subtitles or keyframes are not all prepared yet. */
  pending: number;
  running: boolean;
  waitingFor: PrefetchWait | null;
}

interface Job {
  fileId: number;
  mtimeMs: number;
  size: number;
  path: string;
  root: string;
  /** Text subtitles not extracted yet. */
  indexes: number[];
  /** Keyframes not known yet. */
  keyframes: boolean;
}

type Step = 'done' | 'stopped' | 'failed' | 'empty' | PrefetchWait;

/**
 * Prepares every file for playback ahead of time: extracts its embedded text subtitles, so a viewer
 * who picks one does not wait for FFmpeg to read the whole file, and finds its keyframes, so the
 * website can play it in pieces (HLS) and seek within one stream. Both read the whole file. Works one file at a time at the lowest priority, newest
 * files first: in the maintenance window whenever nobody watches, outside it (when allowed) only after
 * the server has been quiet for a while. When someone starts watching or the window closes, the file
 * being read is stopped (nothing is kept half) and read again later.
 */
export class SubtitlePrefetcher {
  /** Files whose subtitles or keyframes could not be read, by id and modification time: tried again only once the file changes. */
  private failed = new Set<string>();
  private failedKeyframes = new Set<string>();
  private lastBusyAt: number;
  private running = false;
  private waitingFor: PrefetchWait | null = null;
  private loop: Promise<void> | null = null;
  private stopped = false;
  private wake: (() => void) | null = null;
  private stopCurrent: (() => void) | null = null;

  constructor(
    private readonly db: DB,
    private readonly extractor: Pick<EmbeddedSubtitleExtractor, 'isCached' | 'extractAll'>,
    private readonly hooks: PrefetchHooks,
    private readonly keyframes: KeyframeStore | null = null,
  ) {
    this.lastBusyAt = this.now();
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  start(): void {
    this.stopped = false;
    this.loop ??= this.run();
  }

  /** Look again now (after a scan, or when the setting changed). */
  poke(): void {
    this.wake?.();
  }

  stop(): void {
    this.stopped = true;
    this.stopCurrent?.();
    this.wake?.();
  }

  status(): PrefetchStatus {
    return { enabled: this.hooks.enabled(), pending: this.pending().length, running: this.running, waitingFor: this.running ? null : this.waitingFor };
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const step = await this.step();
      const retry = this.hooks.retryMs ?? RETRY_MS;
      // Nothing to do (or turned off): a scan or a changed setting wakes it sooner.
      if (step === 'empty' || step === 'off') await this.sleep(retry * 30);
      else if (step !== 'done' && step !== 'failed') await this.sleep(retry);
    }
    this.loop = null;
  }

  /** Files whose text subtitles or keyframes are not all prepared yet, newest first. */
  private pending(): Job[] {
    const rows = this.db
      .select({ id: mediaFiles.id, path: mediaFiles.path, size: mediaFiles.size, mtimeMs: mediaFiles.mtimeMs, tracks: mediaFiles.subtitleTracks, container: mediaFiles.container, videoCodec: mediaFiles.videoCodec, audioCodec: mediaFiles.audioCodec, durationSec: mediaFiles.durationSec, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(mediaFiles.libraryId, libraries.id))
      .orderBy(desc(mediaFiles.addedAt), desc(mediaFiles.id))
      .all();
    const jobs: Job[] = [];
    for (const r of rows) {
      const version = `${r.id}-${Math.floor(r.mtimeMs)}`;
      const indexes = this.failed.has(version) ? [] : (r.tracks ?? []).filter((t) => t.textBased && !this.extractor.isCached(r.id, r.mtimeMs, t.index)).map((t) => t.index);
      const keyframes = !!this.keyframes && !this.failedKeyframes.has(version) && needsKeyframes(r) && !this.keyframes.ready(keyframesKey(r));
      if (indexes.length || keyframes) jobs.push({ fileId: r.id, mtimeMs: r.mtimeMs, size: r.size, path: r.path, root: r.root, indexes, keyframes });
    }
    return jobs;
  }

  /** What keeps it from starting now; also remembers when the server was last busy. */
  private blocked(): PrefetchWait | null {
    if (!this.hooks.enabled()) return 'off';
    const busy = this.hooks.busy();
    if (busy) {
      this.lastBusyAt = this.now();
      return busy;
    }
    if (this.hooks.inWindow()) return null;
    if (!this.hooks.outsideWindow()) return 'window';
    return this.now() - this.lastBusyAt < (this.hooks.quietMs ?? QUIET_MS) ? 'quiet' : null;
  }

  /** One round: prepares the next file, or says why not. */
  async step(): Promise<Step> {
    const wait = this.blocked();
    this.waitingFor = wait;
    if (wait) return wait;
    const job = this.pending()[0];
    if (!job) return 'empty';
    const version = `${job.fileId}-${Math.floor(job.mtimeMs)}`;
    const abs = resolveMediaPath(job.root, job.path);
    if (!abs) {
      this.failed.add(version);
      this.failedKeyframes.add(version);
      return 'failed';
    }
    const controller = new AbortController();
    this.stopCurrent = () => controller.abort();
    // Someone starts watching (or a scan begins): this read stops, unless that viewer waits for it.
    const check = setInterval(() => {
      if (this.blocked()) controller.abort();
    }, this.hooks.checkMs ?? CHECK_MS);
    check.unref?.();
    this.running = true;
    let failed = false;
    try {
      if (job.indexes.length) {
        try {
          await this.extractor.extractAll(job.fileId, job.mtimeMs, abs, job.indexes, { sizeBytes: job.size, signal: controller.signal });
        } catch (err) {
          if (isStopped(err)) return 'stopped';
          this.failed.add(version);
          failed = true;
          log.warn(`Could not extract the subtitles of ${job.path} ahead of time: ${(err as Error).message}`);
        }
      }
      if (job.keyframes && this.keyframes) {
        try {
          await this.keyframes.learn(keyframesKey({ id: job.fileId, size: job.size, mtimeMs: job.mtimeMs }), abs, controller.signal);
        } catch (err) {
          if (err instanceof KeyframesStopped) return 'stopped';
          this.failedKeyframes.add(version);
          failed = true;
          log.warn(`Could not find the keyframes of ${job.path} ahead of time: ${(err as Error).message}`);
        }
      }
      return failed ? 'failed' : 'done';
    } finally {
      clearInterval(check);
      this.running = false;
      this.stopCurrent = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      this.wake = done;
    });
  }
}
