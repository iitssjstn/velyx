import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isNotNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import type { AppConfig } from '../config.js';
import { collections, episodes, mediaFiles, movies, people, seasons, shows } from '../db/schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('storage');
const GB = 1024 ** 3;

export type DiskLevel = 'ok' | 'low' | 'critical';

export interface DiskInfo {
  total: number;
  free: number;
  used: number;
  level: DiskLevel;
}

export interface CacheInfo {
  bytes: number;
  files: number;
  /** Files no longer referenced by anything in the library. */
  unusedBytes: number;
  unusedFiles: number;
}

export interface StorageReport {
  disk: DiskInfo | null;
  velyx: { database: number; artwork: number; subtitles: number; avatars: number; backups: number; total: number };
  cache: { artwork: CacheInfo; subtitles: CacheInfo };
  thresholds: { lowBytes: number; criticalBytes: number };
  computedAt: number;
}

/** Free-space thresholds (LOW_DISK_GB / CRITICAL_DISK_GB). */
export function diskLevel(free: number, lowBytes: number, criticalBytes: number): DiskLevel {
  if (free < criticalBytes) return 'critical';
  if (free < lowBytes) return 'low';
  return 'ok';
}

export function statDisk(p: string, lowBytes: number, criticalBytes: number): DiskInfo | null {
  try {
    const s = fs.statfsSync(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - s.bfree * s.bsize, level: diskLevel(free, lowBytes, criticalBytes) };
  } catch {
    return null;
  }
}

async function walk(dir: string, visit: (file: string, size: number) => void): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, visit);
    else if (e.isFile()) {
      try {
        visit(p, (await fsp.stat(p)).size);
      } catch {
        /* removed meanwhile */
      }
    }
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  await walk(dir, (_f, size) => (total += size));
  return total;
}

/**
 * Disk and cache accounting. Folder sizes need a directory walk, which is slow on large artwork
 * caches and old disks, so a report is computed at most every `ttlMs` (or on request) and cached.
 */
export class StorageService {
  private report: StorageReport | null = null;
  private computing: Promise<StorageReport> | null = null;
  readonly lowBytes: number;
  readonly criticalBytes: number;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {
    this.lowBytes = config.lowDiskGb * GB;
    this.criticalBytes = config.criticalDiskGb * GB;
  }

  /** Current state of the data volume (cheap: one statfs call). */
  dataDisk(): DiskInfo | null {
    return statDisk(this.config.dataDir, this.lowBytes, this.criticalBytes);
  }

  async get(force = false): Promise<StorageReport> {
    if (!force && this.report && Date.now() - this.report.computedAt < this.ttlMs) return { ...this.report, disk: this.dataDisk() };
    this.computing ??= this.compute().finally(() => (this.computing = null));
    this.report = await this.computing;
    return this.report;
  }

  /** Artwork file names ("w342/abc.jpg" → "abc.jpg") referenced by the library. */
  private referencedArtwork(): Set<string> {
    const names = new Set<string>();
    const add = (rows: { p: string | null }[]) => rows.forEach((r) => r.p && names.add(r.p.replace(/^\//, '')));
    add(this.db.select({ p: movies.posterPath }).from(movies).where(isNotNull(movies.posterPath)).all());
    add(this.db.select({ p: movies.backdropPath }).from(movies).where(isNotNull(movies.backdropPath)).all());
    add(this.db.select({ p: shows.posterPath }).from(shows).where(isNotNull(shows.posterPath)).all());
    add(this.db.select({ p: shows.backdropPath }).from(shows).where(isNotNull(shows.backdropPath)).all());
    add(this.db.select({ p: seasons.posterPath }).from(seasons).where(isNotNull(seasons.posterPath)).all());
    add(this.db.select({ p: episodes.stillPath }).from(episodes).where(isNotNull(episodes.stillPath)).all());
    add(this.db.select({ p: people.profilePath }).from(people).where(isNotNull(people.profilePath)).all());
    add(this.db.select({ p: collections.posterPath }).from(collections).where(isNotNull(collections.posterPath)).all());
    add(this.db.select({ p: collections.backdropPath }).from(collections).where(isNotNull(collections.backdropPath)).all());
    return names;
  }

  /** Extracted subtitle cache keys "<fileId>-<stream>-<mtime>" that still match a media file. */
  private subtitleKeyValid(): (name: string) => boolean {
    const files = new Map(this.db.select({ id: mediaFiles.id, mtime: mediaFiles.mtimeMs }).from(mediaFiles).all().map((f) => [f.id, Math.floor(f.mtime)]));
    return (name) => {
      const m = /^(\d+)-\d+-(\d+)\.vtt$/.exec(name);
      return Boolean(m && files.get(Number(m[1])) === Number(m[2]));
    };
  }

  private async scanCache(kind: 'artwork' | 'subtitles', collectUnused?: string[]): Promise<CacheInfo> {
    const info: CacheInfo = { bytes: 0, files: 0, unusedBytes: 0, unusedFiles: 0 };
    const dir = kind === 'artwork' ? this.config.imageCacheDir : this.config.subtitleCacheDir;
    const used = kind === 'artwork' ? ((names: Set<string>) => (f: string) => names.has(path.basename(f)))(this.referencedArtwork()) : ((valid) => (f: string) => valid(path.basename(f)))(this.subtitleKeyValid());
    await walk(dir, (file, size) => {
      info.bytes += size;
      info.files++;
      if (!used(file)) {
        info.unusedBytes += size;
        info.unusedFiles++;
        collectUnused?.push(file);
      }
    });
    return info;
  }

  private async compute(): Promise<StorageReport> {
    const dbSize = ['', '-wal'].reduce((s, suffix) => {
      try {
        return s + fs.statSync(this.config.dbPath + suffix).size;
      } catch {
        return s;
      }
    }, 0);
    const [artwork, subtitles, avatars, backups] = await Promise.all([
      this.scanCache('artwork'),
      this.scanCache('subtitles'),
      dirSize(this.config.avatarDir),
      dirSize(this.config.backupDir),
    ]);
    return {
      disk: this.dataDisk(),
      velyx: { database: dbSize, artwork: artwork.bytes, subtitles: subtitles.bytes, avatars, backups, total: dbSize + artwork.bytes + subtitles.bytes + avatars + backups },
      cache: { artwork, subtitles },
      thresholds: { lowBytes: this.lowBytes, criticalBytes: this.criticalBytes },
      computedAt: Date.now(),
    };
  }

  /**
   * Deletes cache files that nothing in the library uses any more (artwork of removed items,
   * subtitles extracted from files that changed or were removed). Never touches media.
   */
  async cleanup(kind: 'artwork' | 'subtitles'): Promise<{ files: number; bytes: number }> {
    const unused: string[] = [];
    const info = await this.scanCache(kind, unused);
    const root = path.resolve(kind === 'artwork' ? this.config.imageCacheDir : this.config.subtitleCacheDir);
    let files = 0;
    for (const f of unused) {
      if (!path.resolve(f).startsWith(root + path.sep)) continue;
      await fsp.rm(f, { force: true });
      files++;
    }
    log.info(`Removed ${files} unused ${kind} cache file(s)`);
    this.report = null;
    return { files, bytes: info.unusedBytes };
  }
}

/**
 * Checks the data volume every few minutes: warns when space runs low and pauses scanning (which
 * writes artwork and database rows) when it is critical, resuming automatically once there is room.
 */
export class DiskMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastLevel: DiskLevel = 'ok';

  constructor(
    private readonly storage: StorageService,
    private readonly onChange: (level: DiskLevel, disk: DiskInfo) => void,
  ) {}

  check(): DiskInfo | null {
    const disk = this.storage.dataDisk();
    if (!disk) return null;
    if (disk.level !== this.lastLevel) {
      const free = `${(disk.free / GB).toFixed(1)} GB free`;
      if (disk.level === 'critical') log.error(`Storage critically low on the data volume: ${free}`);
      else if (disk.level === 'low') log.warn(`Storage running low on the data volume: ${free}`);
      else log.info(`Storage back to normal: ${free}`);
      this.lastLevel = disk.level;
      this.onChange(disk.level, disk);
    }
    return disk;
  }

  get level(): DiskLevel {
    return this.lastLevel;
  }

  start(intervalMs = 5 * 60 * 1000): void {
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
