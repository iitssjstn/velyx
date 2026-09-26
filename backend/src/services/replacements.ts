import path from 'node:path';
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  collectionItems,
  collections,
  continueDismissals,
  episodes,
  favorites,
  mediaFiles,
  mediaReplacements,
  movies,
  retiredItems,
  shows,
  watchlist,
  watchProgress,
  type FileSnapshot,
  type RetiredUserData,
} from '../db/schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('replacements');

/** How long user data of vanished items is kept for a possible return. */
export const RETIRED_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

/** Release source from a file name: "Blu-ray Remux", "Blu-ray", "WEB", "HDTV", "DVD". */
export function releaseSource(name: string): string | null {
  const n = name.toLowerCase().replace(/[._]/g, ' ');
  if (/\bremux\b/.test(n)) return 'Blu-ray Remux';
  if (/\b(blu ?ray|bdrip|brrip|bd25|bd50|bdremux)\b/.test(n)) return 'Blu-ray';
  if (/\b(web ?dl|web ?rip|web|amzn|nf|dsnp|hmax|atvp)\b/.test(n)) return 'WEB';
  if (/\bhdtv\b/.test(n)) return 'HDTV';
  if (/\b(dvd ?rip|dvd|dvd9|dvd5)\b/.test(n)) return 'DVD';
  return null;
}

type FileRow = Pick<typeof mediaFiles.$inferSelect, 'path' | 'size' | 'width' | 'height' | 'videoCodec' | 'videoRange' | 'audioCodec' | 'audioChannels'>;

export function snapshot(f: FileRow): FileSnapshot {
  const name = path.basename(f.path);
  return {
    name,
    size: f.size,
    width: f.width,
    height: f.height,
    videoCodec: f.videoCodec,
    videoRange: f.videoRange,
    audioCodec: f.audioCodec,
    audioChannels: f.audioChannels,
    source: releaseSource(name),
  };
}

/** The same file (e.g. a drive that was briefly unmounted), not a replacement. */
function sameFile(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.name === b.name && a.size === b.size;
}

const emptyData = (): RetiredUserData => ({ progress: [], favorites: [], watchlist: [], collections: [], dismissals: [] });

function hasData(d: RetiredUserData): boolean {
  return Boolean(d.progress.length || d.favorites.length || d.watchlist.length || d.collections.length || d.dismissals.length);
}

type Target = { movieId: number } | { episodeId: number };

/** A movie, show or episode that is about to be retired: who it is and where it was. */
export type RetiredRef = { id: number; libraryId: number; groupKey: string; tmdbId: number | null };

/**
 * Keeps watch history and user choices when media is replaced. Two cases:
 *
 * - The file of a movie or episode is swapped within one scan (Radarr/Sonarr upgrades): the item
 *   keeps its id and data; the swap is recorded.
 * - An item disappears entirely (its last file is gone) and comes back later, possibly under a
 *   different file name: its user data is set aside ("retired") and restored when a movie or show
 *   with the same identity (group key or TMDB id, plus season/episode) appears again.
 */
export class ReplacementTracker {
  constructor(private readonly db: DB) {}

  record(target: Target, previous: FileSnapshot, current: FileSnapshot, at = Date.now()): void {
    if (sameFile(previous, current)) return;
    this.db
      .insert(mediaReplacements)
      .values({ movieId: 'movieId' in target ? target.movieId : null, episodeId: 'episodeId' in target ? target.episodeId : null, previous, current, at })
      .run();
  }

  // ---------------------------------------------------------------- retiring (before deletion)

  retireMovies(ids: number[], lastFiles: Map<string, FileSnapshot>): void {
    for (const m of this.rows(movies, ids)) {
      const data = emptyData();
      data.progress = this.progressOf(eq(watchProgress.movieId, m.id));
      data.favorites = this.db.select({ userId: favorites.userId, createdAt: favorites.createdAt }).from(favorites).where(eq(favorites.movieId, m.id)).all();
      data.watchlist = this.db.select({ userId: watchlist.userId, createdAt: watchlist.createdAt }).from(watchlist).where(eq(watchlist.movieId, m.id)).all();
      data.collections = this.manualCollections(eq(collectionItems.movieId, m.id));
      data.dismissals = this.db.select({ userId: continueDismissals.userId, at: continueDismissals.at }).from(continueDismissals).where(and(eq(continueDismissals.kind, 'movie'), eq(continueDismissals.itemId, m.id))).all();
      this.db
        .insert(retiredItems)
        .values({ kind: 'movie', libraryId: m.libraryId, groupKey: m.groupKey, tmdbId: m.tmdbId, title: m.title, lastFile: lastFiles.get(`movie:${m.id}`) ?? null, userData: data })
        .run();
    }
  }

  retireEpisodes(ids: number[], lastFiles: Map<string, FileSnapshot>): void {
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 500) {
      const rows = this.db
        .select({ id: episodes.id, s: episodes.seasonNumber, e: episodes.episodeNumber, showId: shows.id, libraryId: shows.libraryId, groupKey: shows.groupKey, tmdbId: shows.tmdbId, show: shows.title })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(inArray(episodes.id, ids.slice(i, i + 500)))
        .all();
      for (const r of rows) {
        const data = emptyData();
        data.progress = this.progressOf(eq(watchProgress.episodeId, r.id));
        const lastFile = lastFiles.get(`episode:${r.id}`) ?? null;
        // Nothing to bring back and nothing to compare with: no need to remember it.
        if (!hasData(data) && !lastFile) continue;
        this.db
          .insert(retiredItems)
          .values({ kind: 'episode', libraryId: r.libraryId, groupKey: r.groupKey, tmdbId: r.tmdbId, seasonNumber: r.s, episodeNumber: r.e, title: `${r.show} S${pad(r.s)}E${pad(r.e)}`, lastFile, userData: data })
          .run();
      }
    }
  }

  retireShows(ids: number[]): void {
    for (const s of this.rows(shows, ids)) {
      const data = emptyData();
      data.favorites = this.db.select({ userId: favorites.userId, createdAt: favorites.createdAt }).from(favorites).where(eq(favorites.showId, s.id)).all();
      data.watchlist = this.db.select({ userId: watchlist.userId, createdAt: watchlist.createdAt }).from(watchlist).where(eq(watchlist.showId, s.id)).all();
      data.collections = this.manualCollections(eq(collectionItems.showId, s.id));
      data.dismissals = this.db.select({ userId: continueDismissals.userId, at: continueDismissals.at }).from(continueDismissals).where(and(eq(continueDismissals.kind, 'show'), eq(continueDismissals.itemId, s.id))).all();
      if (!hasData(data)) continue;
      this.db.insert(retiredItems).values({ kind: 'show', libraryId: s.libraryId, groupKey: s.groupKey, tmdbId: s.tmdbId, title: s.title, userData: data }).run();
    }
  }

  // ---------------------------------------------------------------- restoring (after a scan)

  /** A new movie row: bring back what users had for the same title, and record the file change. */
  restoreMovie(movieId: number): boolean {
    const m = this.db.select().from(movies).where(eq(movies.id, movieId)).get();
    if (!m) return false;
    const match = this.findRetired('movie', m.libraryId, m.groupKey, m.tmdbId);
    if (!match) return false;
    const d = match.userData;
    for (const p of d.progress) this.upsertProgress({ movieId }, p);
    for (const f of d.favorites) this.db.insert(favorites).values({ userId: f.userId, movieId, createdAt: f.createdAt }).onConflictDoNothing().run();
    for (const w of d.watchlist) this.db.insert(watchlist).values({ userId: w.userId, movieId, createdAt: w.createdAt }).onConflictDoNothing().run();
    for (const c of this.existingCollections(d.collections)) this.db.insert(collectionItems).values({ collectionId: c.collectionId, movieId, addedAt: c.addedAt }).onConflictDoNothing().run();
    for (const x of d.dismissals) this.db.insert(continueDismissals).values({ userId: x.userId, kind: 'movie', itemId: movieId, at: x.at }).onConflictDoNothing().run();
    this.recordReturn({ movieId }, match.lastFile, eq(mediaFiles.movieId, movieId));
    this.db.delete(retiredItems).where(eq(retiredItems.id, match.id)).run();
    if (hasData(d)) log.info(`Restored watch history for "${m.title}" (it was replaced or had disappeared)`);
    return true;
  }

  restoreShow(showId: number): boolean {
    const s = this.db.select().from(shows).where(eq(shows.id, showId)).get();
    if (!s) return false;
    const match = this.findRetired('show', s.libraryId, s.groupKey, s.tmdbId);
    if (!match) return false;
    const d = match.userData;
    for (const f of d.favorites) this.db.insert(favorites).values({ userId: f.userId, showId, createdAt: f.createdAt }).onConflictDoNothing().run();
    for (const w of d.watchlist) this.db.insert(watchlist).values({ userId: w.userId, showId, createdAt: w.createdAt }).onConflictDoNothing().run();
    for (const c of this.existingCollections(d.collections)) this.db.insert(collectionItems).values({ collectionId: c.collectionId, showId, addedAt: c.addedAt }).onConflictDoNothing().run();
    for (const x of d.dismissals) this.db.insert(continueDismissals).values({ userId: x.userId, kind: 'show', itemId: showId, at: x.at }).onConflictDoNothing().run();
    this.db.delete(retiredItems).where(eq(retiredItems.id, match.id)).run();
    log.info(`Restored favorites and watchlist entries for "${s.title}"`);
    return true;
  }

  restoreEpisode(episodeId: number): boolean {
    const e = this.db
      .select({ id: episodes.id, s: episodes.seasonNumber, e: episodes.episodeNumber, libraryId: shows.libraryId, groupKey: shows.groupKey, tmdbId: shows.tmdbId })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(episodes.id, episodeId))
      .get();
    if (!e) return false;
    const match = this.findRetired('episode', e.libraryId, e.groupKey, e.tmdbId, e.s, e.e);
    if (!match) return false;
    for (const p of match.userData.progress) this.upsertProgress({ episodeId }, p);
    this.recordReturn({ episodeId }, match.lastFile, eq(mediaFiles.episodeId, episodeId));
    this.db.delete(retiredItems).where(eq(retiredItems.id, match.id)).run();
    return true;
  }

  /** Whether anything waits to be recognised (skips the lookups when nothing does). Items can move between libraries. */
  hasRetired(_libraryId?: number): boolean {
    return Boolean(this.db.select({ id: retiredItems.id }).from(retiredItems).limit(1).get());
  }

  /**
   * After items were retired: when the same title already exists in another library (it moved,
   * and that library happened to be scanned first), its data goes there right away.
   */
  adoptElsewhere(retired: { movies: RetiredRef[]; shows: RetiredRef[]; episodes: Array<RetiredRef & { s: number; e: number }> }): number {
    let adopted = 0;
    for (const x of retired.shows) {
      const identity = x.tmdbId !== null ? or(eq(shows.groupKey, x.groupKey), eq(shows.tmdbId, x.tmdbId)) : eq(shows.groupKey, x.groupKey);
      const other = this.db.select({ id: shows.id }).from(shows).where(and(identity, ne(shows.libraryId, x.libraryId), ne(shows.id, x.id))).limit(1).get();
      if (other) this.restoreShow(other.id);
    }
    for (const m of retired.movies) {
      const identity = m.tmdbId !== null ? or(eq(movies.groupKey, m.groupKey), eq(movies.tmdbId, m.tmdbId)) : eq(movies.groupKey, m.groupKey);
      const other = this.db.select({ id: movies.id }).from(movies).where(and(identity, ne(movies.libraryId, m.libraryId), ne(movies.id, m.id))).orderBy(desc(movies.addedAt)).limit(1).get();
      if (other && this.restoreMovie(other.id)) adopted++;
    }
    for (const e of retired.episodes) {
      const identity = e.tmdbId !== null ? or(eq(shows.groupKey, e.groupKey), eq(shows.tmdbId, e.tmdbId)) : eq(shows.groupKey, e.groupKey);
      const other = this.db
        .select({ id: episodes.id })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(and(identity, ne(shows.libraryId, e.libraryId), ne(episodes.id, e.id), eq(episodes.seasonNumber, e.s), eq(episodes.episodeNumber, e.e)))
        .limit(1)
        .get();
      if (other && this.restoreEpisode(other.id)) adopted++;
    }
    return adopted;
  }

  /** Forgets retired items after `RETIRED_KEEP_MS`. */
  purge(now = Date.now()): number {
    return this.db.delete(retiredItems).where(lt(retiredItems.retiredAt, now - RETIRED_KEEP_MS)).run().changes;
  }

  // ---------------------------------------------------------------- helpers

  private rows<T extends typeof movies | typeof shows>(table: T, ids: number[]): Array<T['$inferSelect']> {
    const out: Array<T['$inferSelect']> = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...(this.db.select().from(table as typeof movies).where(inArray((table as typeof movies).id, ids.slice(i, i + 500))).all() as Array<T['$inferSelect']>));
    return out;
  }

  private progressOf(where: ReturnType<typeof eq>) {
    return this.db
      .select({ userId: watchProgress.userId, positionSec: watchProgress.positionSec, durationSec: watchProgress.durationSec, completed: watchProgress.completed, playCount: watchProgress.playCount, updatedAt: watchProgress.updatedAt })
      .from(watchProgress)
      .where(where)
      .all();
  }

  private manualCollections(where: ReturnType<typeof eq>) {
    // TMDB collections are rebuilt from metadata; only hand-made memberships need remembering.
    return this.db
      .select({ collectionId: collectionItems.collectionId, addedAt: collectionItems.addedAt })
      .from(collectionItems)
      .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
      .where(and(where, eq(collections.kind, 'manual')))
      .all();
  }

  private existingCollections(list: RetiredUserData['collections']) {
    if (!list.length) return [];
    const ids = new Set(this.db.select({ id: collections.id }).from(collections).where(inArray(collections.id, list.map((c) => c.collectionId))).all().map((c) => c.id));
    return list.filter((c) => ids.has(c.collectionId));
  }

  private findRetired(kind: 'movie' | 'show' | 'episode', libraryId: number, groupKey: string, tmdbId: number | null, season?: number, episode?: number) {
    const identity = tmdbId !== null ? or(eq(retiredItems.groupKey, groupKey), eq(retiredItems.tmdbId, tmdbId)) : eq(retiredItems.groupKey, groupKey);
    const numbers = kind === 'episode' ? and(eq(retiredItems.seasonNumber, season!), eq(retiredItems.episodeNumber, episode!)) : undefined;
    return this.db
      .select()
      .from(retiredItems)
      // Also from another library (a movie moved from "Movies" to "4K Movies"); the same library first.
      .where(and(eq(retiredItems.kind, kind), identity, numbers))
      .orderBy(desc(sql`${retiredItems.libraryId} = ${libraryId}`), desc(retiredItems.retiredAt), desc(retiredItems.id))
      .limit(1)
      .get();
  }

  /** Keeps whichever progress is newer: the restored one or one saved since. */
  private upsertProgress(target: Target, p: RetiredUserData['progress'][number]): void {
    const where = 'movieId' in target ? eq(watchProgress.movieId, target.movieId) : eq(watchProgress.episodeId, target.episodeId);
    const existing = this.db.select().from(watchProgress).where(and(eq(watchProgress.userId, p.userId), where)).get();
    if (existing && existing.updatedAt >= p.updatedAt) return;
    if (existing) {
      this.db.update(watchProgress).set({ positionSec: p.positionSec, durationSec: p.durationSec, completed: p.completed, playCount: Math.max(p.playCount, existing.playCount), updatedAt: p.updatedAt }).where(eq(watchProgress.id, existing.id)).run();
    } else {
      this.db.insert(watchProgress).values({ userId: p.userId, ...target, positionSec: p.positionSec, durationSec: p.durationSec, completed: p.completed, playCount: p.playCount, updatedAt: p.updatedAt }).run();
    }
  }

  private recordReturn(target: Target, lastFile: FileSnapshot | null, filesWhere: ReturnType<typeof eq>): void {
    if (!lastFile) return;
    const current = this.db.select().from(mediaFiles).where(and(filesWhere, isNotNull(mediaFiles.id))).orderBy(desc(mediaFiles.size)).limit(1).get();
    if (current) this.record(target, lastFile, snapshot(current));
  }

  /** Replacements of one movie or episode, newest first. */
  history(target: Target, limit = 5) {
    const where = 'movieId' in target ? eq(mediaReplacements.movieId, target.movieId) : eq(mediaReplacements.episodeId, target.episodeId);
    return this.db.select({ previous: mediaReplacements.previous, current: mediaReplacements.current, at: mediaReplacements.at }).from(mediaReplacements).where(where).orderBy(desc(mediaReplacements.at), desc(mediaReplacements.id)).limit(limit).all();
  }

  /** Recent replacements across libraries, for the Library health page. */
  recent(sinceMs: number, libraryId?: number) {
    return this.db
      .select({
        id: mediaReplacements.id,
        movieId: mediaReplacements.movieId,
        episodeId: mediaReplacements.episodeId,
        previous: mediaReplacements.previous,
        current: mediaReplacements.current,
        at: mediaReplacements.at,
      })
      .from(mediaReplacements)
      .leftJoin(movies, eq(movies.id, mediaReplacements.movieId))
      .leftJoin(episodes, eq(episodes.id, mediaReplacements.episodeId))
      .leftJoin(shows, eq(shows.id, episodes.showId))
      .where(and(sql`${mediaReplacements.at} >= ${sinceMs}`, libraryId ? sql`coalesce(${movies.libraryId}, ${shows.libraryId}) = ${libraryId}` : undefined))
      .orderBy(desc(mediaReplacements.at))
      .all();
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "2160p · HEVC · HDR10 · Blu-ray · 18.2 GB" */
export function snapshotLabel(s: FileSnapshot): string {
  const res = !s.width || !s.height ? null : s.width >= 3200 || s.height >= 2000 ? '2160p' : s.width >= 1800 || s.height >= 1000 ? '1080p' : s.width >= 1200 || s.height >= 700 ? '720p' : `${s.height}p`;
  const codec = s.videoCodec ? ({ h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' } as Record<string, string>)[s.videoCodec] ?? s.videoCodec.toUpperCase() : null;
  const size = s.size >= 1024 ** 3 ? `${(s.size / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(s.size / 1024 ** 2))} MB`;
  return [res, codec, s.videoRange && s.videoRange !== 'SDR' ? (s.videoRange === 'DV' ? 'Dolby Vision' : s.videoRange) : null, s.source, size].filter(Boolean).join(' · ');
}
