import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, libraries, mediaFiles, movies, seasons, shows, subtitles } from '../db/schema.js';
import { createLogger } from '../logger.js';
import type { MetadataService } from './metadata.js';
import {
  isExtraFile,
  isSubtitleFile,
  isVideoFile,
  normalizeTitle,
  parseEpisodePath,
  parseMoviePath,
  parseSubtitleName,
  sortTitle,
} from './parser.js';
import type { Prober, ProbeResult } from './probe.js';

const log = createLogger('scanner');

const SKIP_DIRS = new Set(['@eadir', '#recycle', '$recycle.bin', 'lost+found', '.trash', '.trashes', 'system volume information']);

export interface ScanProgress {
  phase: 'discovering' | 'analyzing' | 'cleaning' | 'metadata' | 'done';
  processed: number;
  total: number;
  /** Path (relative to the library) of the file being analysed. */
  currentFile?: string | null;
}

export interface ScanOptions {
  refreshMetadata?: boolean;
  onProgress?: (p: ScanProgress) => void;
  /** Awaited between files; resolves when the scan may continue (used to pause scans). */
  checkpoint?: () => Promise<void>;
}

export interface ScanSummary {
  found: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  failed: number;
  unparsed: number;
  metadataMatched: number;
  metadataUnmatched: number;
  durationMs: number;
}

interface DiscoveredFiles {
  videos: string[];
  subtitlesByDir: Map<string, string[]>;
}

export async function discoverFiles(root: string): Promise<DiscoveredFiles> {
  const videos: string[] = [];
  const subtitlesByDir = new Map<string, string[]>();
  const visited = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let real: string;
    try {
      real = await fsp.realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return; // symlink loop protection
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Cannot read folder ${dir}`, err);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = await fsp.stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) await walk(full);
      } else if (isFile) {
        if (isVideoFile(entry.name)) videos.push(full);
        else if (isSubtitleFile(entry.name)) {
          const list = subtitlesByDir.get(dir) ?? [];
          list.push(entry.name);
          subtitlesByDir.set(dir, list);
        }
      }
    }
  }

  await walk(root);
  videos.sort();
  return { videos, subtitlesByDir };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export class LibraryScanner {
  constructor(
    private readonly db: DB,
    private readonly probe: Prober,
    private readonly metadata: MetadataService,
    private readonly probeConcurrency = 1,
  ) {}

  async scan(libraryId: number, opts: ScanOptions = {}): Promise<ScanSummary> {
    const started = Date.now();
    const lib = this.db.select().from(libraries).where(eq(libraries.id, libraryId)).get();
    if (!lib) throw new Error(`Library ${libraryId} not found`);
    const report = (p: ScanProgress) => opts.onProgress?.(p);
    const summary: ScanSummary = { found: 0, added: 0, updated: 0, unchanged: 0, removed: 0, failed: 0, unparsed: 0, metadataMatched: 0, metadataUnmatched: 0, durationMs: 0 };

    log.info(`Library scan started: ${lib.name} (${lib.path})`);
    report({ phase: 'discovering', processed: 0, total: 0 });

    let rootStat: fs.Stats;
    try {
      rootStat = await fsp.stat(lib.path);
    } catch {
      throw new Error(`Library folder ${lib.path} is not available. Is the volume mounted?`);
    }
    if (!rootStat.isDirectory()) throw new Error(`${lib.path} is not a folder`);

    const { videos, subtitlesByDir } = await discoverFiles(lib.path);
    const candidates = videos.filter((v) => !isExtraFile(path.relative(lib.path, v)));
    summary.found = candidates.length;
    log.info(`Found ${candidates.length} media files in ${lib.name}`);

    const existing = new Map(this.db.select().from(mediaFiles).where(eq(mediaFiles.libraryId, libraryId)).all().map((f) => [f.path, f]));
    const seen = new Set<string>();
    const newMovieIds = new Set<number>();
    const newShowIds = new Set<number>();
    const showSeasonsToRefresh = new Map<number, Set<number>>();

    report({ phase: 'analyzing', processed: 0, total: candidates.length });
    let processed = 0;

    await mapLimit(candidates, this.probeConcurrency, async (file) => {
      seen.add(file);
      await opts.checkpoint?.();
      report({ phase: 'analyzing', processed, total: candidates.length, currentFile: path.relative(lib.path, file) });
      try {
        const st = await fsp.stat(file);
        const prev = existing.get(file);
        const unchanged = prev && prev.size === st.size && Math.floor(prev.mtimeMs) === Math.floor(st.mtimeMs) && !prev.probeError;
        let fileId: number;
        if (unchanged && prev) {
          fileId = prev.id;
          summary.unchanged++;
        } else {
          let info: ProbeResult | null = null;
          let probeError: string | null = null;
          try {
            info = await this.probe(file);
          } catch (err) {
            probeError = (err as Error).message.slice(0, 500);
            log.warn(`FFprobe failed for ${file}`, err);
            summary.failed++;
          }
          const values = {
            libraryId,
            path: file,
            size: st.size,
            mtimeMs: Math.floor(st.mtimeMs),
            container: info?.container ?? (path.extname(file).slice(1).toLowerCase() || null),
            durationSec: info?.durationSec ?? null,
            bitrate: info?.bitrate ?? null,
            videoCodec: info?.videoCodec ?? null,
            videoProfile: info?.videoProfile ?? null,
            videoBitDepth: info?.videoBitDepth ?? null,
            videoRange: info?.videoRange ?? null,
            width: info?.width ?? null,
            height: info?.height ?? null,
            fps: info?.fps ?? null,
            audioCodec: info?.audioCodec ?? null,
            audioChannels: info?.audioChannels ?? null,
            audioTracks: info?.audioTracks ?? [],
            subtitleTracks: info?.subtitleTracks ?? [],
            probeError,
            updatedAt: Date.now(),
          };
          if (prev) {
            this.db.update(mediaFiles).set(values).where(eq(mediaFiles.id, prev.id)).run();
            fileId = prev.id;
            summary.updated++;
          } else {
            fileId = this.db.insert(mediaFiles).values(values).returning({ id: mediaFiles.id }).get().id;
            summary.added++;
          }
        }

        const current = prev && unchanged ? prev : this.db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get()!;
        if (lib.type === 'movies') {
          if (!current.movieId) {
            const { id, created } = this.linkMovie(libraryId, lib.path, file);
            this.db.update(mediaFiles).set({ movieId: id }).where(eq(mediaFiles.id, fileId)).run();
            if (created) newMovieIds.add(id);
          }
        } else if (!current.episodeId) {
          const linked = this.linkEpisode(libraryId, lib.path, file);
          if (!linked) {
            summary.unparsed++;
            log.warn(`Could not detect season/episode for ${path.relative(lib.path, file)} — expected names like S01E02 or 1x02`);
          } else {
            this.db.update(mediaFiles).set({ episodeId: linked.episodeId }).where(eq(mediaFiles.id, fileId)).run();
            if (linked.showCreated) newShowIds.add(linked.showId);
            else if (linked.episodeCreated) {
              const set = showSeasonsToRefresh.get(linked.showId) ?? new Set<number>();
              set.add(linked.season);
              showSeasonsToRefresh.set(linked.showId, set);
            }
          }
        }
        this.syncSubtitles(fileId, file, subtitlesByDir.get(path.dirname(file)) ?? []);
      } catch (err) {
        summary.failed++;
        log.error(`Failed to process ${file}`, err);
      }
      processed++;
      report({ phase: 'analyzing', processed, total: candidates.length, currentFile: null });
    });

    // ---- removals
    report({ phase: 'cleaning', processed: 0, total: 0 });
    const missing = [...existing.values()].filter((f) => !seen.has(f.path));
    if (candidates.length === 0 && existing.size > 0) {
      log.warn(`No media found in ${lib.path} but ${existing.size} files are known — skipping removal in case the drive is not mounted`);
    } else if (missing.length > 0) {
      const ids = missing.map((f) => f.id);
      for (let i = 0; i < ids.length; i += 500) {
        this.db.delete(mediaFiles).where(inArray(mediaFiles.id, ids.slice(i, i + 500))).run();
      }
      summary.removed = missing.length;
      log.info(`Removed ${missing.length} missing files from ${lib.name}`);
    }
    this.cleanupOrphans(libraryId);

    // ---- metadata
    if (this.metadata.enabled) {
      const movieTargets = lib.type === 'movies'
        ? this.db
            .select({ id: movies.id })
            .from(movies)
            .where(opts.refreshMetadata ? eq(movies.libraryId, libraryId) : and(eq(movies.libraryId, libraryId), eq(movies.matchStatus, 'pending')))
            .all()
            .map((m) => m.id)
        : [];
      const showTargets = lib.type === 'shows'
        ? this.db
            .select({ id: shows.id })
            .from(shows)
            .where(opts.refreshMetadata ? eq(shows.libraryId, libraryId) : and(eq(shows.libraryId, libraryId), eq(shows.matchStatus, 'pending')))
            .all()
            .map((s) => s.id)
        : [];
      const total = movieTargets.length + showTargets.length + showSeasonsToRefresh.size;
      let done = 0;
      report({ phase: 'metadata', processed: 0, total });
      for (const id of movieTargets) {
        const r = await this.metadata.matchMovie(id, opts.refreshMetadata);
        if (r === 'matched') summary.metadataMatched++;
        if (r === 'unmatched') summary.metadataUnmatched++;
        report({ phase: 'metadata', processed: ++done, total });
      }
      for (const id of showTargets) {
        const r = await this.metadata.matchShow(id, opts.refreshMetadata);
        if (r === 'matched') summary.metadataMatched++;
        if (r === 'unmatched') summary.metadataUnmatched++;
        report({ phase: 'metadata', processed: ++done, total });
      }
      if (!opts.refreshMetadata) {
        for (const [showId, set] of showSeasonsToRefresh) {
          if (!showTargets.includes(showId)) await this.metadata.refreshShowSeasons(showId, [...set]);
          report({ phase: 'metadata', processed: ++done, total });
        }
      }
      if (summary.metadataMatched + summary.metadataUnmatched > 0) log.info(`Metadata updated: ${summary.metadataMatched} matched, ${summary.metadataUnmatched} need review`);
    } else if (newMovieIds.size + newShowIds.size > 0) {
      log.info('TMDB is not configured — new items use names from their files. Add a TMDB key in Admin → Metadata.');
    }

    summary.durationMs = Date.now() - started;
    report({ phase: 'done', processed: candidates.length, total: candidates.length });
    log.info(
      `Library scan completed: ${lib.name} — ${summary.added} added, ${summary.updated} updated, ${summary.removed} removed, ${summary.unchanged} unchanged in ${(summary.durationMs / 1000).toFixed(1)}s`,
    );
    return summary;
  }

  private linkMovie(libraryId: number, root: string, file: string): { id: number; created: boolean } {
    const parsed = parseMoviePath(path.relative(root, file));
    const groupKey = parsed.tmdbId ? `tmdb:${parsed.tmdbId}` : `${normalizeTitle(parsed.title)}|${parsed.year ?? ''}`;
    const byKey = this.db
      .select({ id: movies.id })
      .from(movies)
      .where(and(eq(movies.libraryId, libraryId), eq(movies.groupKey, groupKey)))
      .get();
    if (byKey) return { id: byKey.id, created: false };
    if (parsed.tmdbId) {
      const byTmdb = this.db
        .select({ id: movies.id })
        .from(movies)
        .where(and(eq(movies.libraryId, libraryId), eq(movies.tmdbId, parsed.tmdbId)))
        .get();
      if (byTmdb) return { id: byTmdb.id, created: false };
    }
    const row = this.db
      .insert(movies)
      .values({
        libraryId,
        groupKey,
        title: parsed.title,
        sortTitle: sortTitle(parsed.title),
        year: parsed.year,
        parsedTitle: parsed.title,
        parsedYear: parsed.year,
        tmdbId: parsed.tmdbId,
        matchStatus: 'pending',
      })
      .returning({ id: movies.id })
      .get();
    return { id: row.id, created: true };
  }

  private linkEpisode(
    libraryId: number,
    root: string,
    file: string,
  ): { showId: number; episodeId: number; season: number; showCreated: boolean; episodeCreated: boolean } | null {
    const parsed = parseEpisodePath(path.relative(root, file));
    if (!parsed) return null;
    const groupKey = parsed.showTmdbId ? `tmdb:${parsed.showTmdbId}` : `${normalizeTitle(parsed.showTitle)}|${parsed.showYear ?? ''}`;
    let showCreated = false;
    let show = this.db
      .select({ id: shows.id })
      .from(shows)
      .where(and(eq(shows.libraryId, libraryId), eq(shows.groupKey, groupKey)))
      .get();
    if (!show) {
      show = this.db
        .insert(shows)
        .values({
          libraryId,
          groupKey,
          title: parsed.showTitle,
          sortTitle: sortTitle(parsed.showTitle),
          year: parsed.showYear,
          parsedTitle: parsed.showTitle,
          parsedYear: parsed.showYear,
          tmdbId: parsed.showTmdbId,
          matchStatus: 'pending',
        })
        .returning({ id: shows.id })
        .get();
      showCreated = true;
    }
    const season =
      this.db
        .select({ id: seasons.id })
        .from(seasons)
        .where(and(eq(seasons.showId, show.id), eq(seasons.seasonNumber, parsed.season)))
        .get() ??
      this.db
        .insert(seasons)
        .values({ showId: show.id, seasonNumber: parsed.season, name: parsed.season === 0 ? 'Specials' : `Season ${parsed.season}` })
        .returning({ id: seasons.id })
        .get();
    let episodeCreated = false;
    let episode = this.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, parsed.season), eq(episodes.episodeNumber, parsed.episode)))
      .get();
    if (!episode) {
      episode = this.db
        .insert(episodes)
        .values({
          showId: show.id,
          seasonId: season.id,
          seasonNumber: parsed.season,
          episodeNumber: parsed.episode,
          title: parsed.episodeTitle,
        })
        .returning({ id: episodes.id })
        .get();
      episodeCreated = true;
      this.db.update(shows).set({ lastEpisodeAddedAt: Date.now() }).where(eq(shows.id, show.id)).run();
    }
    return { showId: show.id, episodeId: episode.id, season: parsed.season, showCreated, episodeCreated };
  }

  /** Keeps the external subtitle list for a video in sync with the files next to it. */
  private syncSubtitles(fileId: number, videoPath: string, siblings: string[]): void {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const wanted = siblings
      .map((name) => ({ name, info: parseSubtitleName(base, name) }))
      .filter((s): s is { name: string; info: NonNullable<ReturnType<typeof parseSubtitleName>> } => s.info !== null);
    const current = this.db.select().from(subtitles).where(eq(subtitles.mediaFileId, fileId)).all();
    const wantedPaths = new Set(wanted.map((w) => path.join(dir, w.name)));
    for (const row of current) {
      if (!wantedPaths.has(row.path)) this.db.delete(subtitles).where(eq(subtitles.id, row.id)).run();
    }
    const have = new Set(current.map((r) => r.path));
    for (const w of wanted) {
      const full = path.join(dir, w.name);
      if (have.has(full)) continue;
      this.db
        .insert(subtitles)
        .values({
          mediaFileId: fileId,
          path: full,
          format: path.extname(w.name).toLowerCase() === '.vtt' ? 'vtt' : 'srt',
          language: w.info.language,
          label: w.info.label,
          forced: w.info.forced,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  /** Removes movies/episodes/seasons/shows that no longer have any files. */
  cleanupOrphans(libraryId: number): void {
    const noMovieFiles = notExists(this.db.select({ x: sql`1` }).from(mediaFiles).where(eq(mediaFiles.movieId, movies.id)));
    this.db.delete(movies).where(and(eq(movies.libraryId, libraryId), noMovieFiles)).run();

    const showIds = this.db.select({ id: shows.id }).from(shows).where(eq(shows.libraryId, libraryId)).all().map((s) => s.id);
    if (showIds.length === 0) return;
    const noEpisodeFiles = notExists(this.db.select({ x: sql`1` }).from(mediaFiles).where(eq(mediaFiles.episodeId, episodes.id)));
    for (let i = 0; i < showIds.length; i += 500) {
      const chunk = showIds.slice(i, i + 500);
      this.db.delete(episodes).where(and(inArray(episodes.showId, chunk), noEpisodeFiles)).run();
      this.db
        .delete(seasons)
        .where(and(inArray(seasons.showId, chunk), notExists(this.db.select({ x: sql`1` }).from(episodes).where(eq(episodes.seasonId, seasons.id)))))
        .run();
      this.db
        .delete(shows)
        .where(and(inArray(shows.id, chunk), notExists(this.db.select({ x: sql`1` }).from(episodes).where(eq(episodes.showId, shows.id)))))
        .run();
    }
  }

  /** Media files not linked to anything (e.g. unparseable episode names), for admin diagnostics. */
  unlinkedFiles(libraryId: number) {
    return this.db
      .select({ id: mediaFiles.id, path: mediaFiles.path })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.libraryId, libraryId), isNull(mediaFiles.movieId), isNull(mediaFiles.episodeId)))
      .all();
  }

  /** Files whose probe failed, for admin diagnostics. */
  failedFiles(libraryId: number) {
    return this.db
      .select({ id: mediaFiles.id, path: mediaFiles.path, error: mediaFiles.probeError })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.libraryId, libraryId), or(sql`${mediaFiles.probeError} IS NOT NULL`)))
      .all();
  }
}
