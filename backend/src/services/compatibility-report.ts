import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { libraries, mediaFiles, movies, shows } from '../db/schema.js';
import { fileIssues, libraryVerdict, type LibraryVerdict } from '../playback/compatibility.js';
import { resolveMediaPath } from './paths.js';
import type { Prober } from './probe.js';
import { createLogger } from '../logger.js';

const log = createLogger('compatibility');

export interface LibraryCompatibility {
  id: number;
  name: string;
  type: 'movies' | 'shows';
  files: number;
  verdicts: Record<LibraryVerdict, number>;
  /** Most common reasons files need a remux or cannot play, e.g. "HEVC video". */
  issues: { label: string; count: number }[];
  /** Files scanned before 0.4.0 whose bit depth / HDR is not known yet. */
  notAnalyzed: number;
  health: { probeErrors: number; unmatched: number };
}

/**
 * Per-library playback compatibility from cached FFprobe data (no files are opened). Verdicts use a
 * typical current browser; the player still decides per device.
 */
export function compatibilityReport(db: DB): LibraryCompatibility[] {
  const libs = db.select().from(libraries).orderBy(libraries.name).all();
  const files = db
    .select({
      libraryId: mediaFiles.libraryId,
      container: mediaFiles.container,
      videoCodec: mediaFiles.videoCodec,
      videoBitDepth: mediaFiles.videoBitDepth,
      videoRange: mediaFiles.videoRange,
      audioCodec: mediaFiles.audioCodec,
      subtitleTracks: mediaFiles.subtitleTracks,
      probeError: mediaFiles.probeError,
    })
    .from(mediaFiles)
    .all();
  const unmatchedMovies = new Map(
    db.select({ lib: movies.libraryId, n: sql<number>`count(*)` }).from(movies).where(eq(movies.matchStatus, 'unmatched')).groupBy(movies.libraryId).all().map((r) => [r.lib, Number(r.n)]),
  );
  const unmatchedShows = new Map(
    db.select({ lib: shows.libraryId, n: sql<number>`count(*)` }).from(shows).where(eq(shows.matchStatus, 'unmatched')).groupBy(shows.libraryId).all().map((r) => [r.lib, Number(r.n)]),
  );
  return libs.map((lib) => {
    const own = files.filter((f) => f.libraryId === lib.id);
    const verdicts: Record<LibraryVerdict, number> = { direct: 0, remux: 0, 'browser-dependent': 0, incompatible: 0, unknown: 0 };
    const issues = new Map<string, number>();
    let notAnalyzed = 0;
    let probeErrors = 0;
    for (const f of own) {
      verdicts[libraryVerdict(f)]++;
      if (f.probeError) probeErrors++;
      else if (f.videoCodec && f.videoBitDepth === null) notAnalyzed++;
      for (const issue of fileIssues(f)) issues.set(issue, (issues.get(issue) ?? 0) + 1);
    }
    return {
      id: lib.id,
      name: lib.name,
      type: lib.type,
      files: own.length,
      verdicts,
      issues: [...issues.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      notAnalyzed,
      health: { probeErrors, unmatched: lib.type === 'movies' ? (unmatchedMovies.get(lib.id) ?? 0) : (unmatchedShows.get(lib.id) ?? 0) },
    };
  });
}

/**
 * One-off background job that fills in bit depth / HDR for files scanned before 0.4.0, one FFprobe
 * at a time through the shared queue. Started by an admin; never runs on its own.
 */
export class DetailAnalyzer {
  private state = { running: false, done: 0, total: 0, failed: 0 };

  constructor(
    private readonly db: DB,
    private readonly probe: Prober,
  ) {}

  status() {
    return { ...this.state };
  }

  start(): boolean {
    if (this.state.running) return false;
    const rows = this.db
      .select({ id: mediaFiles.id, path: mediaFiles.path, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(and(isNull(mediaFiles.videoBitDepth), isNull(mediaFiles.probeError), isNotNull(mediaFiles.videoCodec)))
      .all();
    this.state = { running: true, done: 0, total: rows.length, failed: 0 };
    if (!rows.length) {
      this.state.running = false;
      return true;
    }
    log.info(`Analysing ${rows.length} files for bit depth and HDR`);
    void (async () => {
      for (const r of rows) {
        const abs = resolveMediaPath(r.root, r.path);
        try {
          if (!abs) throw new Error('file not available');
          const info = await this.probe(abs);
          this.db.update(mediaFiles).set({ videoBitDepth: info.videoBitDepth, videoRange: info.videoRange }).where(eq(mediaFiles.id, r.id)).run();
        } catch {
          this.state.failed++;
        }
        this.state.done++;
      }
      this.state.running = false;
      log.info(`Analysis finished: ${this.state.done - this.state.failed} updated, ${this.state.failed} failed`);
    })();
    return true;
  }
}
