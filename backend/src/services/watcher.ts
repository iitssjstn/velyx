import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/client.js';
import { libraries } from '../db/schema.js';
import { createLogger } from '../logger.js';
import { isSubtitleFile, isVideoFile } from './parser.js';
import type { ScanManager } from './scan-manager.js';

const log = createLogger('watcher');

export interface WatchStatus {
  libraryId: number;
  watching: boolean;
  error: string | null;
}

/**
 * Watches library folders and queues an incremental scan shortly after files change, so items that
 * Radarr/Sonarr (or you) add show up within a minute instead of at the next scheduled scan.
 *
 * Events are debounced per library: a large file that is still being copied keeps producing events,
 * and the scan only runs once the folder has been quiet for `debounceMs`. When the OS refuses a watch
 * (e.g. the inotify limit is reached) the library simply falls back to the scheduled scans.
 */
export class LibraryWatcher {
  private watchers = new Map<number, { path: string; watcher: fs.FSWatcher }>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private errors = new Map<number, string>();
  private enabled = false;

  constructor(
    private readonly db: DB,
    private readonly scans: ScanManager,
    private readonly debounceMs = 30_000,
  ) {}

  /** Starts, stops or re-targets watchers so they match the libraries in the database. */
  sync(enabled: boolean): void {
    this.enabled = enabled;
    const rows = enabled ? this.db.select({ id: libraries.id, path: libraries.path }).from(libraries).all() : [];
    const wanted = new Map(rows.map((r) => [r.id, r.path]));
    for (const [id, w] of this.watchers) {
      if (wanted.get(id) !== w.path) this.unwatch(id);
    }
    for (const [id, dir] of wanted) {
      if (!this.watchers.has(id)) this.watch(id, dir);
    }
    for (const id of [...this.errors.keys()]) if (!wanted.has(id)) this.errors.delete(id);
  }

  status(): WatchStatus[] {
    const ids = new Set([...this.watchers.keys(), ...this.errors.keys()]);
    return [...ids].map((id) => ({ libraryId: id, watching: this.watchers.has(id), error: this.errors.get(id) ?? null }));
  }

  isWatching(libraryId: number): boolean {
    return this.watchers.has(libraryId);
  }

  stop(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private watch(id: number, dir: string): void {
    if (!fs.existsSync(dir)) {
      this.errors.set(id, 'Folder not available');
      return;
    }
    try {
      const watcher = fs.watch(dir, { recursive: true, persistent: false }, (_event, filename) => this.onEvent(id, filename));
      watcher.on('error', (err) => {
        log.warn(`Stopped watching library ${id} (${dir}): ${err.message}. Scheduled scans still apply.`);
        this.errors.set(id, err.message);
        this.unwatch(id);
      });
      this.watchers.set(id, { path: dir, watcher });
      this.errors.delete(id);
      log.info(`Watching ${dir} for new and removed files`);
    } catch (err) {
      const message = (err as NodeJS.ErrnoException).code === 'ENOSPC' ? 'Too many folders to watch (raise fs.inotify.max_user_watches on the host)' : (err as Error).message;
      log.warn(`Cannot watch library ${id} (${dir}): ${message}. Scheduled scans still apply.`);
      this.errors.set(id, message);
    }
  }

  private unwatch(id: number): void {
    const w = this.watchers.get(id);
    if (w) {
      try {
        w.watcher.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.delete(id);
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  /** Only media-relevant changes count: videos, subtitles, and folders (a moved/deleted folder has no extension). */
  private onEvent(id: number, filename: string | Buffer | null): void {
    if (!this.enabled) return;
    const name = filename ? String(filename) : '';
    if (name) {
      const base = path.basename(name);
      if (base.startsWith('.') || /\.(part|partial|tmp|!qb)$/i.test(base)) return;
      const ext = path.extname(base);
      if (ext && !isVideoFile(base) && !isSubtitleFile(base)) return;
    }
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        log.info(`Changes detected in library ${id}, starting an incremental scan`);
        this.scans.enqueue(id);
      }, this.debounceMs).unref(),
    );
  }
}
