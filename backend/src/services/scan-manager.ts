import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { libraries } from '../db/schema.js';
import { createLogger } from '../logger.js';
import type { LibraryScanner, ScanProgress, ScanSummary } from './scanner.js';

const log = createLogger('scan-queue');

export interface ScanJob {
  libraryId: number;
  refreshMetadata: boolean;
  /** Probe every file again instead of only new and changed ones. */
  full: boolean;
}

export interface ScanHooks {
  /** Someone is watching right now. */
  playbackActive?: () => boolean;
  /** Scheduled scans wait (up to a limit) until nobody is watching. */
  deferWhilePlaying?: () => boolean;
  /** Pause between files while someone is watching, so an old disk serves the stream first. */
  yieldMs?: number;
}

/** How long a scheduled scan waits for playback to end before it runs anyway. */
const MAX_DEFER_MS = 6 * 60 * 60 * 1000;
const DEFER_RETRY_MS = 5 * 60 * 1000;

export type ScannerStatus = 'scanning' | 'queued' | 'paused' | 'failed' | 'idle';

export interface ScanState {
  status: ScannerStatus;
  running: { libraryId: number; progress: ScanProgress; startedAt: number } | null;
  queued: ScanJob[];
  /** Why scanning is paused: by an administrator, or automatically because disk space is low. */
  paused: { reason: 'manual' | 'low-disk'; since: number } | null;
  lastSuccess: { libraryId: number; at: number; durationMs: number | null } | null;
  lastFailure: { libraryId: number; at: number; message: string | null } | null;
  /** Automatic scans: interval (0 = off), when the next one is due, and whether it waits for playback to end. */
  schedule: { intervalMinutes: number; nextAt: number | null; waitingForPlayback: boolean };
}

/**
 * Runs library scans one at a time so a low-end CPU never probes several libraries in parallel.
 */
export class ScanManager {
  private queue: ScanJob[] = [];
  private running: ScanState['running'] = null;
  private timer: NodeJS.Timeout | null = null;
  private idleWaiters: Array<() => void> = [];
  private resumeWaiters: Array<() => void> = [];
  private paused: ScanState['paused'] = null;
  private stopped = false;
  private schedule: { intervalMinutes: number; nextAt: number | null; waitingSince: number | null } = { intervalMinutes: 0, nextAt: null, waitingSince: null };

  constructor(
    private readonly db: DB,
    private readonly scanner: LibraryScanner,
    private readonly hooks: ScanHooks = {},
  ) {}

  state(): ScanState {
    const libs = this.db
      .select({ id: libraries.id, lastSuccessAt: libraries.lastSuccessAt, lastFailureAt: libraries.lastFailureAt, durationMs: libraries.lastScanDurationMs, status: libraries.lastScanStatus, message: libraries.lastScanMessage })
      .from(libraries)
      .all();
    const success = libs.filter((l) => l.lastSuccessAt).sort((a, b) => b.lastSuccessAt! - a.lastSuccessAt!)[0];
    const failure = libs.filter((l) => l.lastFailureAt).sort((a, b) => b.lastFailureAt! - a.lastFailureAt!)[0];
    // "failed" while idle: some library's most recent scan did not succeed.
    const failing = libs.some((l) => l.status === 'error');
    const status: ScannerStatus = this.paused ? 'paused' : this.running ? 'scanning' : this.queue.length ? 'queued' : failing ? 'failed' : 'idle';
    return {
      status,
      running: this.running ? { ...this.running, progress: { ...this.running.progress } } : null,
      queued: [...this.queue],
      paused: this.paused ? { ...this.paused } : null,
      lastSuccess: success ? { libraryId: success.id, at: success.lastSuccessAt!, durationMs: success.durationMs } : null,
      lastFailure: failure ? { libraryId: failure.id, at: failure.lastFailureAt!, message: failure.status === 'error' ? failure.message : null } : null,
      schedule: { intervalMinutes: this.schedule.intervalMinutes, nextAt: this.schedule.nextAt, waitingForPlayback: this.schedule.waitingSince !== null },
    };
  }

  /** Stops starting new work; a running scan halts after the file it is on. */
  pause(reason: 'manual' | 'low-disk' = 'manual'): void {
    if (this.paused?.reason === 'manual' && reason === 'low-disk') return;
    if (!this.paused) log.info(reason === 'low-disk' ? 'Scanning paused: disk space is critically low' : 'Scanning paused by an administrator');
    this.paused = { reason, since: this.paused?.since ?? Date.now() };
  }

  /** Resumes scanning. An automatic (low-disk) pause is only lifted by `resume('low-disk')` or an admin. */
  resume(reason: 'manual' | 'low-disk' = 'manual'): void {
    if (!this.paused) return;
    if (reason === 'low-disk' && this.paused.reason === 'manual') return;
    this.paused = null;
    log.info('Scanning resumed');
    this.resumeWaiters.splice(0).forEach((w) => w());
    void this.pump();
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  /** Awaited by the scanner between files: holds while paused, and gives way to playback. */
  private checkpoint = async (): Promise<void> => {
    if (this.paused && !this.stopped) await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    if (!this.stopped && this.hooks.playbackActive?.()) await new Promise((resolve) => setTimeout(resolve, this.hooks.yieldMs ?? 250));
  };

  isBusy(libraryId: number): boolean {
    return this.running?.libraryId === libraryId || this.queue.some((j) => j.libraryId === libraryId);
  }

  enqueue(libraryId: number, refreshMetadata = false, full = false): boolean {
    const queued = this.queue.find((j) => j.libraryId === libraryId);
    if (queued) {
      queued.refreshMetadata ||= refreshMetadata;
      queued.full ||= full;
      return false;
    }
    // A scan that is still listing folders will see the change itself. One that is past that point
    // would miss it, so a follow-up scan is queued (cheap: unchanged files are not probed again).
    if (this.running?.libraryId === libraryId && !refreshMetadata && !full && this.running.progress.phase === 'discovering') return false;
    this.queue.push({ libraryId, refreshMetadata, full });
    void this.pump();
    return true;
  }

  enqueueAll(refreshMetadata = false, full = false): void {
    for (const lib of this.db.select({ id: libraries.id }).from(libraries).all()) this.enqueue(lib.id, refreshMetadata, full);
  }

  /**
   * Automatic scans every `minutes` (0 = off). Each looks for new and changed files only. When
   * scheduled scans should not disturb playback, a due scan waits while someone is watching,
   * checking every few minutes, and runs anyway after a few hours.
   */
  configureSchedule(minutes: number, now = Date.now()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule = { intervalMinutes: Math.max(0, minutes), nextAt: null, waitingSince: null };
    if (minutes <= 0) {
      log.info('Scheduled library scans are off');
      return;
    }
    this.scheduleAt(now + minutes * 60_000);
    log.info(`Scheduled library scans every ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} minutes`}`);
  }

  private scheduleAt(at: number): void {
    if (this.stopped) return;
    this.schedule.nextAt = at;
    this.timer = setTimeout(() => this.runSchedule(), Math.max(0, at - Date.now()));
    this.timer.unref();
  }

  /** A scheduled scan is due (public for tests). */
  runSchedule(now = Date.now()): void {
    const { intervalMinutes } = this.schedule;
    if (intervalMinutes <= 0 || this.stopped) return;
    const wait = Boolean(this.hooks.deferWhilePlaying?.() && this.hooks.playbackActive?.());
    const waited = this.schedule.waitingSince === null ? 0 : now - this.schedule.waitingSince;
    if (wait && waited < Math.min(MAX_DEFER_MS, intervalMinutes * 60_000)) {
      if (this.schedule.waitingSince === null) log.info('Scheduled scan waits until nobody is watching');
      this.schedule.waitingSince ??= now;
      this.scheduleAt(now + DEFER_RETRY_MS);
      return;
    }
    this.schedule.waitingSince = null;
    this.enqueueAll(false);
    this.scheduleAt(now + intervalMinutes * 60_000);
  }

  /** Resolves when the queue is empty (used by tests and the CLI). */
  whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.schedule.nextAt = null;
    this.queue = [];
    this.resumeWaiters.splice(0).forEach((w) => w());
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped || this.paused) return;
    const job = this.queue.shift();
    if (!job) {
      const waiters = this.idleWaiters.splice(0);
      waiters.forEach((w) => w());
      return;
    }
    this.running = { libraryId: job.libraryId, progress: { phase: 'discovering', processed: 0, total: 0 }, startedAt: Date.now() };
    this.db.update(libraries).set({ lastScanStatus: 'running', lastScanMessage: null }).where(eq(libraries.id, job.libraryId)).run();
    try {
      const summary: ScanSummary = await this.scanner.scan(job.libraryId, {
        refreshMetadata: job.refreshMetadata,
        full: job.full,
        checkpoint: this.checkpoint,
        onProgress: (p) => {
          if (this.running) this.running.progress = p;
        },
      });
      const parts = [`${summary.found} files`, `${summary.added} added`, `${summary.removed} removed`];
      if (summary.metadataUnmatched) parts.push(`${summary.metadataUnmatched} need review`);
      if (summary.unparsed) parts.push(`${summary.unparsed} not recognized`);
      if (summary.failed) parts.push(`${summary.failed} failed`);
      this.db
        .update(libraries)
        .set({ lastScanAt: Date.now(), lastScanStatus: 'ok', lastScanMessage: parts.join(', '), lastSuccessAt: Date.now(), lastScanDurationMs: summary.durationMs })
        .where(eq(libraries.id, job.libraryId))
        .run();
    } catch (err) {
      log.error(`Library scan failed`, err);
      this.db
        .update(libraries)
        .set({ lastScanAt: Date.now(), lastScanStatus: 'error', lastScanMessage: (err as Error).message.slice(0, 500), lastFailureAt: Date.now(), lastScanDurationMs: Date.now() - this.running!.startedAt })
        .where(eq(libraries.id, job.libraryId))
        .run();
    } finally {
      this.running = null;
      setImmediate(() => void this.pump());
    }
  }
}
