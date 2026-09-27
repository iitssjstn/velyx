import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { cleanupDecisions, cleanupPlanned, episodes, libraries, mediaFiles, movies, shows, userLibraries, users, watchProgress } from '../db/schema.js';
import { resolveMediaPath } from './paths.js';
import { tr, type Language } from '../i18n/index.js';
import { DEFAULT_CLEANUP_RULES, type CleanupRules, type CustomCleanupRule } from './settings.js';
import { formatSummary } from './library-health.js';

export type CleanupRule = keyof CleanupRules | 'custom';
export const CLEANUP_RULES: CleanupRule[] = ['unwatched', 'stale', 'large', 'duplicates', 'missingInfo', 'custom'];
const BUILT_IN = CLEANUP_RULES.filter((r): r is keyof CleanupRules => r !== 'custom');

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
  /** "HEVC · 2160p · 10-bit · HDR10 · E-AC3 5.1 · MKV" */
  format: string;
  /** For possible duplicates: every version of the title, the one Velyx would keep first. */
  versions: { fileId: number; name: string; format: string; size: number; keep: boolean }[] | null;
  reasons: { rule: CleanupRule; text: string; ruleId?: string }[];
  /** An own rule planned this file for deletion on `dueAt` (it can still be kept until then). */
  plan: { ruleId: string; rule: string; dueAt: number } | null;
}

/** What an own rule looks at for one file. */
export interface FileFacts {
  kind: 'movie' | 'episode';
  libraryId: number;
  size: number;
  addedAt: number;
  /** Anyone started it. */
  started: boolean;
  /** Users who finished it. */
  watchedBy: number;
  /** Users who can see its library (for "watched by everyone"). */
  audience: number;
  lastWatchedAt: number | null;
}

/** Whether a file matches an own rule: every condition that is set must hold. */
export function matchesCustomRule(rule: CustomCleanupRule, f: FileFacts, now: number): boolean {
  if (!rule.enabled) return false;
  if (rule.libraryId !== null && rule.libraryId !== f.libraryId) return false;
  if (rule.kind !== 'all' && rule.kind !== f.kind) return false;
  if (rule.watched === 'nobody' && f.started) return false;
  if (rule.watched === 'someone' && f.watchedBy < 1) return false;
  if (rule.watched === 'everyone' && (f.audience < 1 || f.watchedBy < f.audience)) return false;
  if (rule.addedDays !== null && now - f.addedAt < rule.addedDays * DAY) return false;
  if (rule.notPlayedDays !== null && now - (f.lastWatchedAt ?? f.addedAt) < rule.notPlayedDays * DAY) return false;
  if (rule.minGb !== null && f.size <= rule.minGb * GB) return false;
  // A rule without any condition would match everything: never.
  return rule.watched !== 'any' || rule.addedDays !== null || rule.notPlayedDays !== null || rule.minGb !== null;
}

/** How many active users can see each library (administrators see all of them). */
export function libraryAudience(db: DB): Map<number, number> {
  const libs = db.select({ id: libraries.id }).from(libraries).all();
  const people = db.select({ id: users.id, role: users.role, all: users.allLibraries }).from(users).where(eq(users.disabled, false)).all();
  const grants = db.select().from(userLibraries).all();
  const out = new Map<number, number>();
  for (const l of libs) out.set(l.id, people.filter((u) => u.role === 'admin' || u.all || grants.some((g) => g.userId === u.id && g.libraryId === l.id)).length);
  return out;
}

/** HDR and Dolby Vision count as better than SDR at the same resolution. */
const rangeRank = (r: string | null) => (r === 'DV' ? 2 : r === 'HDR10' || r === 'HLG' ? 1 : 0);
const heightBucket = (h: number | null) => (!h ? 0 : h >= 2000 ? 4 : h >= 1000 ? 3 : h >= 700 ? 2 : 1);

/**
 * Which of two versions is better to keep: higher resolution, then HDR, then the larger file (a
 * higher bitrate at the same resolution). Only a suggestion; the administrator decides.
 */
export function betterVersion<T extends { height: number | null; videoRange: string | null; size: number; probeError: string | null }>(a: T, b: T): T {
  if (Boolean(a.probeError) !== Boolean(b.probeError)) return a.probeError ? b : a;
  return (
    heightBucket(b.height) - heightBucket(a.height) ||
    rangeRank(b.videoRange) - rangeRank(a.videoRange) ||
    b.size - a.size
  ) > 0
    ? b
    : a;
}

export interface CleanupSummary {
  rules: CleanupRules;
  custom: CustomCleanupRule[];
  counts: Record<CleanupRule, { files: number; bytes: number }>;
  total: { files: number; bytes: number };
  kept: number;
}

const DAY = 86_400_000;

/** "8.2 GB": sizes inside reasons (the page formats sizes itself everywhere else). */
function formatBytesPlain(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
const GB = 1024 ** 3;

/** Stored rules with defaults filled in (settings from older versions may lack a rule). */
export function effectiveRules(stored: Partial<CleanupRules> | undefined): CleanupRules {
  const out = { ...DEFAULT_CLEANUP_RULES } as CleanupRules;
  for (const k of BUILT_IN) (out as unknown as Record<string, object>)[k] = { ...DEFAULT_CLEANUP_RULES[k], ...(stored?.[k] ?? {}) };
  return out;
}

const resolution = (h: number | null, lang: Language) => (!h ? tr(lang, 'unknown resolution') : h >= 2000 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : `${h}p`);
const ago = (ms: number, lang: Language) => {
  const days = Math.floor(ms / DAY);
  if (days >= 60) return tr(lang, '{n} months', { n: Math.round(days / 30) });
  return days === 1 ? tr(lang, '1 day') : tr(lang, '{n} days', { n: days });
};

/**
 * Suggests files to remove, from data Velyx already has (no file is read). Rules only produce
 * suggestions; files an administrator chose to keep are left out until they change.
 */
export function cleanupCandidates(db: DB, rules: CleanupRules, now = Date.now(), lang: Language = 'en', custom: CustomCleanupRule[] = []): { candidates: CleanupCandidate[]; kept: number } {
  const files = db
    .select({
      f: mediaFiles,
      library: libraries.name,
      movieTitle: movies.title,
      movieYear: movies.year,
      movieMatch: movies.matchStatus,
      movieTmdb: movies.tmdbId,
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

  // Versions of one title: files of one movie or episode, and movies that are the same TMDB entry
  // (for example once in a normal and once in a 4K library). The best version is never the duplicate.
  const groupOf = (r: (typeof files)[number]) => (r.f.movieId ? (r.movieTmdb ? `t${r.movieTmdb}` : `m${r.f.movieId}`) : `e${r.f.episodeId}`);
  const best = new Map<string, (typeof files)[number]['f']>();
  const members = new Map<string, Array<(typeof files)[number]['f']>>();
  for (const r of files) {
    const g = groupOf(r);
    members.set(g, [...(members.get(g) ?? []), r.f]);
    const b = best.get(g);
    best.set(g, b ? betterVersion(b, r.f) : r.f);
  }

  const kept = new Map(db.select().from(cleanupDecisions).all().map((d) => [d.mediaFileId, d.size]));
  const audience = custom.some((c) => c.enabled && c.watched === 'everyone') ? libraryAudience(db) : new Map<number, number>();
  const planned = new Map(db.select().from(cleanupPlanned).all().map((p) => [p.mediaFileId, p]));
  let keptCount = 0;
  const out: CleanupCandidate[] = [];
  for (const r of files) {
    const f = r.f;
    const key = f.movieId ? `m${f.movieId}` : `e${f.episodeId}`;
    const w = watch.get(key) ?? { started: false, watchedBy: 0, last: null };
    const reasons: CleanupCandidate['reasons'] = [];
    if (rules.unwatched.enabled && !w.started && now - f.addedAt > rules.unwatched.days * DAY) reasons.push({ rule: 'unwatched', text: tr(lang, 'Never watched, added {time} ago', { time: ago(now - f.addedAt, lang) }) });
    if (rules.stale.enabled && w.started && w.last !== null && now - w.last > rules.stale.days * DAY) reasons.push({ rule: 'stale', text: tr(lang, 'Not played for {time}', { time: ago(now - w.last, lang) }) });
    if (rules.large.enabled && f.size > rules.large.gb * GB) reasons.push({ rule: 'large', text: tr(lang, 'Larger than {n} GB', { n: rules.large.gb }) });
    const group = groupOf(r);
    const siblings = members.get(group) ?? [];
    const isDuplicate = rules.duplicates.enabled && siblings.length > 1 && best.get(group)!.id !== f.id;
    if (isDuplicate) {
      const b = best.get(group)!;
      reasons.push({ rule: 'duplicates', text: tr(lang, 'Another version exists: {version}', { version: `${formatSummary(b) || resolution(b.height, lang)}, ${formatBytesPlain(b.size)}, ${path.basename(b.path)}` }) });
    }
    if (rules.missingInfo.enabled) {
      if (f.probeError) reasons.push({ rule: 'missingInfo', text: tr(lang, 'The file could not be read: {error}', { error: f.probeError }) });
      else if ((f.movieId ? r.movieMatch : r.showMatch) === 'unmatched') reasons.push({ rule: 'missingInfo', text: tr(lang, 'Not identified: no metadata found') });
    }
    const facts: FileFacts = { kind: f.movieId ? 'movie' : 'episode', libraryId: f.libraryId, size: f.size, addedAt: f.addedAt, started: w.started, watchedBy: w.watchedBy, audience: audience.get(f.libraryId) ?? 0, lastWatchedAt: w.last };
    for (const c of custom) if (matchesCustomRule(c, facts, now)) reasons.push({ rule: 'custom', ruleId: c.id, text: tr(lang, 'Your rule "{rule}"', { rule: c.name }) });
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
      format: formatSummary(f),
      versions: isDuplicate
        ? [...siblings]
            .sort((a, b) => (betterVersion(a, b) === a ? -1 : 1))
            .map((v) => ({ fileId: v.id, name: path.basename(v.path), format: formatSummary(v), size: v.size, keep: v.id === best.get(group)!.id }))
        : null,
      reasons,
      plan: (() => {
        const p = planned.get(f.id);
        const rule = p && p.size === f.size ? custom.find((c) => c.id === p.ruleId) : undefined;
        return p && rule ? { ruleId: rule.id, rule: rule.name, dueAt: p.dueAt } : null;
      })(),
    });
  }
  out.sort((a, b) => b.size - a.size);
  return { candidates: out, kept: keptCount };
}

export function summarize(rules: CleanupRules, candidates: CleanupCandidate[], kept: number, custom: CustomCleanupRule[] = []): CleanupSummary {
  const counts = Object.fromEntries(CLEANUP_RULES.map((r) => [r, { files: 0, bytes: 0 }])) as CleanupSummary['counts'];
  for (const c of candidates) {
    for (const rule of new Set(c.reasons.map((x) => x.rule))) {
      counts[rule].files++;
      counts[rule].bytes += c.size;
    }
  }
  return { rules, custom, counts, total: { files: candidates.length, bytes: candidates.reduce((n, c) => n + c.size, 0) }, kept };
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
export function deleteFiles(db: DB, fileIds: number[], candidates: Set<number>, lang: Language = 'en'): DeleteResult[] {
  const results: DeleteResult[] = [];
  for (const id of [...new Set(fileIds)]) {
    const row = db.select({ f: mediaFiles, root: libraries.path }).from(mediaFiles).innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId)).where(eq(mediaFiles.id, id)).get();
    const fail = (error: string, params?: Record<string, string>) => results.push({ fileId: id, libraryId: row?.f.libraryId ?? null, path: row?.f.path ?? null, size: row?.f.size ?? 0, ok: false, error: tr(lang, error, params) });
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
      fail('Could not delete the file: {reason}', { reason: (err as NodeJS.ErrnoException).code ?? (err as Error).message });
    }
  }
  return results;
}
