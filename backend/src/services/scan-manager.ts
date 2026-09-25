import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { libraries } from '../db/schema.js';
import { createLogger } from '../logger.js';
import type { LibraryScanner, ScanProgress, ScanSummary } from './scanner.js';

const log = createLogger('scan-queue');

export interface ScanJob {
  libraryId: number;
  refreshMetadata: boolean;
}

export interface ScanState {
  running: { libraryId: number; progress: ScanProgress; startedAt: number } | null;
  queued: ScanJob[];
}

/**
 * Runs library scans one at a time so a low-end CPU never probes several libraries in parallel.
 */
export class ScanManager {
  private queue: ScanJob[] = [];
  private running: ScanState['running'] = null;
  private timer: NodeJS.Timeout | null = null;
  private idleWaiters: Array<() => void> = [];
  private stopped = false;

  constructor(
    private readonly db: DB,
    private readonly scanner: LibraryScanner,
  ) {}

  state(): ScanState {
    return { running: this.running ? { ...this.running, progress: { ...this.running.progress } } : null, queued: [...this.queue] };
  }

  isBusy(libraryId: number): boolean {
    return this.running?.libraryId === libraryId || this.queue.some((j) => j.libraryId === libraryId);
  }

  enqueue(libraryId: number, refreshMetadata = false): boolean {
    const queued = this.queue.find((j) => j.libraryId === libraryId);
    if (queued) {
      queued.refreshMetadata ||= refreshMetadata;
      return false;
    }
    if (this.running?.libraryId === libraryId && !refreshMetadata) return false;
    this.queue.push({ libraryId, refreshMetadata });
    void this.pump();
    return true;
  }

  enqueueAll(refreshMetadata = false): void {
    for (const lib of this.db.select({ id: libraries.id }).from(libraries).all()) this.enqueue(lib.id, refreshMetadata);
  }

  /** Resolves when the queue is empty (used by tests and the CLI). */
  whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  startSchedule(intervalMinutes: number): void {
    if (intervalMinutes <= 0) {
      log.info('Periodic library scans disabled (SCAN_INTERVAL_MINUTES=0)');
      return;
    }
    this.timer = setInterval(() => this.enqueueAll(false), intervalMinutes * 60 * 1000);
    this.timer.unref();
    log.info(`Incremental library scans every ${intervalMinutes} minutes`);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.queue = [];
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped) return;
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
        .set({ lastScanAt: Date.now(), lastScanStatus: 'ok', lastScanMessage: parts.join(', ') })
        .where(eq(libraries.id, job.libraryId))
        .run();
    } catch (err) {
      log.error(`Library scan failed`, err);
      this.db
        .update(libraries)
        .set({ lastScanAt: Date.now(), lastScanStatus: 'error', lastScanMessage: (err as Error).message.slice(0, 500) })
        .where(eq(libraries.id, job.libraryId))
        .run();
    } finally {
      this.running = null;
      setImmediate(() => void this.pump());
    }
  }
}
