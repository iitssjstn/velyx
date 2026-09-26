import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { cleanupDecisions, episodes, libraries, mediaFiles, movies, shows, watchProgress } from '../db/schema.js';
import { resolveMediaPath } from './paths.js';
import { DEFAULT_CLEANUP_RULES, type CleanupRules } from './settings.js';

export type CleanupRule = keyof CleanupRules;
export const CLEANUP_RULES: CleanupRule[] = ['unwatched', 'stale', 'large', 'duplicates', 'missingInfo'];

export interface CleanupCandidate {
  fileId: number;
  libraryId: number;
  library: string;
  kind: 'movie' | 'episode';
  title: string;
  subtitle: string | null;
  href: string | null;
  path: string;
  size: number;
  width: number | null;
  height: number | null;
  addedAt: number;
  /** Users who finished it, and whether anyone started it. */
  watchedBy: number;
  started: boolean;
  lastWatchedAt: number | null;
  reasons: { rule: CleanupRule; text: string }[];
}

export interface CleanupSummary {
  rules: CleanupRules;
  counts: Record<CleanupRule, { files: number; bytes: number }>;
  total: { files: number; bytes: number };
  kept: number;
}

const DAY = 86_400_000;
const GB = 1024 ** 3;

/** Stored rules with defaults filled in (settings from older versions may lack a rule). */
export function effectiveRules(stored: Partial<CleanupRules> | undefined): CleanupRules {
  const out = { ...DEFAULT_CLEANUP_RULES } as CleanupRules;
  for (const k of CLEANUP_RULES) (out as unknown as Record<string, object>)[k] = { ...DEFAULT_CLEANUP_RULES[k], ...(stored?.[k] ?? {}) };
  return out;
}

const resolution = (h: number | null) => (!h ? 'unknown resolution' : h >= 2000 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : `${h}p`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (ms: number) => {
  const days = Math.floor(ms / DAY);
  return days >= 60 ? `${Math.round(days / 30)} months` : plural(days, 'day');
};

/**
 * Suggests files to remove, from data Velyx already has (no file is read). Rules only produce
 * suggestions; files an administrator chose to keep are left out until they change.
 */
export function cleanupCandidates(db: DB, rules: CleanupRules, now = Date.now()): { candidates: CleanupCandidate[]; kept: number } {
  const files = db
    .select({
      f: mediaFiles,
      library: libraries.name,
      movieTitle: movies.title,
      movieYear: movies.year,
      movieMatch: movies.matchStatus,
      showId: shows.id,
      showTitle: shows.title,
      showMatch: shows.matchStatus,
      season: episodes.seasonNumber,
      episode: episodes.episodeNumber,
    })
    .from(mediaFiles)
    .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
    .leftJoin(movies, eq(movies.id, mediaFiles.movieId))
    .leftJoin(episodes, eq(episodes.id, mediaFiles.episodeId))
    .leftJoin(shows, eq(shows.id, episodes.showId))
    .all()
    .filter((r) => r.f.movieId !== null || r.f.episodeId !== null);

  // Watch state per movie / episode, over all users.
  const watch = new Map<string, { started: boolean; watchedBy: number; last: number | null }>();
  for (const w of db
    .select({
      movieId: watchProgress.movieId,
      episodeId: watchProgress.episodeId,
      started: sql<number>`max(case when ${watchProgress.positionSec} > 0 or ${watchProgress.completed} or ${watchProgress.playCount} > 0 then 1 else 0 end)`,
      watchedBy: sql<number>`sum(case when ${watchProgress.completed} or ${watchProgress.playCount} > 0 then 1 else 0 end)`,
      last: sql<number | null>`max(case when ${watchProgress.positionSec} > 0 or ${watchProgress.completed} or ${watchProgress.playCount} > 0 then ${watchProgress.updatedAt} end)`,
    })
    .from(watchProgress)
    .groupBy(watchProgress.movieId, watchProgress.episodeId)
    .all()) {
    watch.set(w.movieId ? `m${w.movieId}` : `e${w.episodeId}`, { started: w.started === 1, watchedBy: w.watchedBy, last: w.last });
  }

  // The version playback picks first (highest resolution, then largest) is never the duplicate.
  const best = new Map<string, (typeof files)[number]['f']>();
  const versions = new Map<string, number>();
  for (const { f } of files) {
    const key = f.movieId ? `m${f.movieId}` : `e${f.episodeId}`;
    versions.set(key, (versions.get(key) ?? 0) + 1);
    const b = best.get(key);
    if (!b || (f.height ?? 0) > (b.height ?? 0) || ((f.height ?? 0) === (b.height ?? 0) && f.size > b.size)) best.set(key, f);
  }

  const kept = new Map(db.select().from(cleanupDecisions).all().map((d) => [d.mediaFileId, d.size]));
  let keptCount = 0;
  const out: CleanupCandidate[] = [];
  for (const r of files) {
    const f = r.f;
    const key = f.movieId ? `m${f.movieId}` : `e${f.episodeId}`;
    const w = watch.get(key) ?? { started: false, watchedBy: 0, last: null };
    const reasons: CleanupCandidate['reasons'] = [];
    if (rules.unwatched.enabled && !w.started && now - f.addedAt > rules.unwatched.days * DAY) reasons.push({ rule: 'unwatched', text: `Never watched, added ${ago(now - f.addedAt)} ago` });
    if (rules.stale.enabled && w.started && w.last !== null && now - w.last > rules.stale.days * DAY) reasons.push({ rule: 'stale', text: `Not played for ${ago(now - w.last)}` });
    if (rules.large.enabled && f.size > rules.large.gb * GB) reasons.push({ rule: 'large', text: `Larger than ${rules.large.gb} GB` });
    if (rules.duplicates.enabled && (versions.get(key) ?? 0) > 1 && best.get(key)!.id !== f.id) {
      const b = best.get(key)!;
      reasons.push({ rule: 'duplicates', text: `Another version exists: ${resolution(b.height)}, ${path.basename(b.path)}` });
    }
    if (rules.missingInfo.enabled) {
      if (f.probeError) reasons.push({ rule: 'missingInfo', text: `The file could not be read: ${f.probeError}` });
      else if ((f.movieId ? r.movieMatch : r.showMatch) === 'unmatched') reasons.push({ rule: 'missingInfo', text: 'Not identified: no metadata found' });
    }
    if (!reasons.length) continue;
    if (kept.get(f.id) === f.size) {
      keptCount++;
      continue;
    }
    out.push({
      fileId: f.id,
      libraryId: f.libraryId,
      library: r.library,
      kind: f.movieId ? 'movie' : 'episode',
      title: f.movieId ? (r.movieTitle ?? path.basename(f.path)) : (r.showTitle ?? path.basename(f.path)),
      subtitle: f.movieId ? (r.movieYear ? String(r.movieYear) : null) : r.season !== null ? `S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')}` : null,
      href: f.movieId ? `/movies/${f.movieId}` : r.showId ? `/shows/${r.showId}` : null,
      path: f.path,
      size: f.size,
      width: f.width,
      height: f.height,
      addedAt: f.addedAt,
      watchedBy: w.watchedBy,
      started: w.started,
      lastWatchedAt: w.last,
      reasons,
    });
  }
  out.sort((a, b) => b.size - a.size);
  return { candidates: out, kept: keptCount };
}

export function summarize(rules: CleanupRules, candidates: CleanupCandidate[], kept: number): CleanupSummary {
  const counts = Object.fromEntries(CLEANUP_RULES.map((r) => [r, { files: 0, bytes: 0 }])) as CleanupSummary['counts'];
  for (const c of candidates) {
    for (const rule of new Set(c.reasons.map((x) => x.rule))) {
      counts[rule].files++;
      counts[rule].bytes += c.size;
    }
  }
  return { rules, counts, total: { files: candidates.length, bytes: candidates.reduce((n, c) => n + c.size, 0) }, kept };
}

/** Whether Velyx may write in the library folder (a read-only mount makes deleting impossible). */
export function libraryWritable(root: string): boolean {
  try {
    fs.accessSync(root, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function keepFiles(db: DB, fileIds: number[], by: string): number {
  if (!fileIds.length) return 0;
  const rows = db.select({ id: mediaFiles.id, size: mediaFiles.size }).from(mediaFiles).where(inArray(mediaFiles.id, fileIds)).all();
  for (const r of rows) {
    const values = { mediaFileId: r.id, size: r.size, decidedBy: by, decidedAt: Date.now() };
    db.insert(cleanupDecisions).values(values).onConflictDoUpdate({ target: cleanupDecisions.mediaFileId, set: values }).run();
  }
  return rows.length;
}

export function unkeepFile(db: DB, fileId: number): boolean {
  return db.delete(cleanupDecisions).where(eq(cleanupDecisions.mediaFileId, fileId)).run().changes > 0;
}

/** Files an administrator chose to keep, with who decided and when. */
export function keptFiles(db: DB) {
  return db
    .select({ fileId: cleanupDecisions.mediaFileId, path: mediaFiles.path, size: mediaFiles.size, decidedBy: cleanupDecisions.decidedBy, decidedAt: cleanupDecisions.decidedAt })
    .from(cleanupDecisions)
    .innerJoin(mediaFiles, and(eq(mediaFiles.id, cleanupDecisions.mediaFileId), eq(mediaFiles.size, cleanupDecisions.size)))
    .all();
}

export interface DeleteResult {
  fileId: number;
  libraryId: number | null;
  path: string | null;
  size: number;
  ok: boolean;
  error: string | null;
}

/**
 * Deletes media files. Only for files that are current suggestions, only inside their library
 * folder, only regular files, and only when the folder is writable. Callers check the setting and
 * the explicit confirmation first. Returns a result per file; nothing else is touched.
 */
export function deleteFiles(db: DB, fileIds: number[], candidates: Set<number>): DeleteResult[] {
  const results: DeleteResult[] = [];
  for (const id of [...new Set(fileIds)]) {
    const row = db.select({ f: mediaFiles, root: libraries.path }).from(mediaFiles).innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId)).where(eq(mediaFiles.id, id)).get();
    const fail = (error: string) => results.push({ fileId: id, libraryId: row?.f.libraryId ?? null, path: row?.f.path ?? null, size: row?.f.size ?? 0, ok: false, error });
    if (!row) {
      fail('This file is no longer in the library.');
      continue;
    }
    if (!candidates.has(id)) {
      fail('This file is not a clean-up suggestion (any more).');
      continue;
    }
    const abs = resolveMediaPath(row.root, row.f.path);
    if (!abs) {
      fail('The file was not found inside its library folder.');
      continue;
    }
    try {
      if (!fs.lstatSync(abs).isFile()) {
        fail('Not a regular file.');
        continue;
      }
      fs.accessSync(path.dirname(abs), fs.constants.W_OK);
    } catch {
      fail('The library folder is read-only. Mount it without :ro to allow deleting.');
      continue;
    }
    try {
      fs.unlinkSync(abs);
      results.push({ fileId: id, libraryId: row.f.libraryId, path: row.f.path, size: row.f.size, ok: true, error: null });
    } catch (err) {
      fail(`Could not delete the file: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    }
  }
  return results;
}
