/**
 * Admin → Clean-up and Admin → Backup in the app: the shapes of the server's admin API (the same as
 * the website's) and what the two screens show of them.
 */

import { formatBytes } from './admin';
import { ago } from './format';
import type { MessageKey, Translate } from './i18n';

// ---- clean-up

export type CleanupRule = 'unwatched' | 'stale' | 'large' | 'duplicates' | 'missingInfo' | 'custom';

export interface CleanupRules {
  unwatched: { enabled: boolean; days: number };
  stale: { enabled: boolean; days: number };
  large: { enabled: boolean; gb: number };
  duplicates: { enabled: boolean };
  missingInfo: { enabled: boolean };
}

/** An administrator's own rule (the server's CustomCleanupRule). */
export interface OwnRule {
  id?: string;
  name: string;
  enabled: boolean;
  libraryId: number | null;
  kind: 'all' | 'movie' | 'episode';
  watched: 'any' | 'nobody' | 'someone' | 'everyone';
  addedDays: number | null;
  notPlayedDays: number | null;
  minGb: number | null;
  action: 'suggest' | 'delete';
  graceDays: number;
}

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
  watchedBy: number;
  started: boolean;
  lastWatchedAt: number | null;
  format?: string;
  versions?: { fileId: number; name: string; format: string; size: number; keep: boolean }[] | null;
  reasons: { rule: CleanupRule; text: string; ruleId?: string }[];
  plan?: { ruleId: string; rule: string; dueAt: number } | null;
}

export interface CleanupList {
  summary: { rules: CleanupRules; custom?: OwnRule[]; counts: Partial<Record<CleanupRule, { files: number; bytes: number }>>; total: { files: number; bytes: number }; kept: number };
  deletion: { enabled: boolean; libraries: { id: number; name: string; path: string; writable: boolean }[] };
  total: number;
  bytes: number;
  items: CleanupCandidate[];
}

export interface DeleteResult {
  fileId: number;
  path: string | null;
  size: number;
  ok: boolean;
  error: string | null;
}

export interface KeptFile {
  fileId: number;
  path: string;
  size: number;
  decidedBy: string;
  decidedAt: number;
}

export interface PlannedDeletion {
  fileId: number;
  title: string;
  subtitle: string | null;
  library: string;
  size: number;
  rule: string;
  dueAt: number;
}

export interface RulePreview {
  files: number;
  bytes: number;
  items: { fileId: number; title: string; subtitle: string | null }[];
}

export const CLEANUP_PAGE_SIZE = 50;
export const RULE_ORDER: CleanupRule[] = ['unwatched', 'stale', 'large', 'duplicates', 'missingInfo', 'custom'];
export const MAX_OWN_RULES = 20;
/** Files named in the delete confirmation; the rest is counted. */
export const DELETE_LIST_MAX = 8;

export const EMPTY_RULE: OwnRule = { name: '', enabled: true, libraryId: null, kind: 'all', watched: 'everyone', addedDays: 30, notPlayedDays: null, minGb: null, action: 'suggest', graceDays: 7 };

export function cleanupPath(filter: { rule: CleanupRule | null; libraryId: number | null; page: number }): string {
  const parts = [`page=${filter.page}`, `limit=${CLEANUP_PAGE_SIZE}`];
  if (filter.rule) parts.push(`rule=${filter.rule}`);
  if (filter.libraryId !== null) parts.push(`libraryId=${filter.libraryId}`);
  return `/api/admin/cleanup?${parts.join('&')}`;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CLEANUP_PAGE_SIZE));
}

/** The rule filters: "Your own rules" only once there is one. */
export function visibleRules(summary: Pick<CleanupList['summary'], 'custom'>): CleanupRule[] {
  return RULE_ORDER.filter((r) => r !== 'custom' || (summary.custom?.length ?? 0) > 0);
}

export function ruleOn(summary: Pick<CleanupList['summary'], 'rules' | 'custom'>, rule: CleanupRule): boolean {
  return rule === 'custom' ? (summary.custom ?? []).some((r) => r.enabled) : summary.rules[rule].enabled;
}

/** "Never watched · 12" or "Large files · off" for a filter chip. */
export function ruleChipLabel(summary: Pick<CleanupList['summary'], 'rules' | 'custom' | 'counts'>, rule: CleanupRule, t: Translate): string {
  const name = t(`cleanup.rule.${rule}` as MessageKey);
  if (!ruleOn(summary, rule)) return `${name} · ${t('cleanup.off')}`;
  return `${name} · ${summary.counts[rule]?.files ?? 0}`;
}

/** Selects or unselects one file. */
export function toggleSelected(selected: ReadonlyMap<number, CleanupCandidate>, c: CleanupCandidate): Map<number, CleanupCandidate> {
  const next = new Map(selected);
  if (next.has(c.fileId)) next.delete(c.fileId);
  else next.set(c.fileId, c);
  return next;
}

export function allSelected(selected: ReadonlyMap<number, CleanupCandidate>, items: CleanupCandidate[]): boolean {
  return items.length > 0 && items.every((c) => selected.has(c.fileId));
}

/** Selects the whole page, or unselects it when it already was. */
export function togglePage(selected: ReadonlyMap<number, CleanupCandidate>, items: CleanupCandidate[]): Map<number, CleanupCandidate> {
  const all = allSelected(selected, items);
  const next = new Map(selected);
  for (const c of items) {
    if (all) next.delete(c.fileId);
    else next.set(c.fileId, c);
  }
  return next;
}

export function totalBytes(items: { size: number }[]): number {
  return items.reduce((n, c) => n + c.size, 0);
}

/** "Watched by 2 users · last 3 days ago", "Never watched". */
export function watchStatus(c: Pick<CleanupCandidate, 'started' | 'watchedBy' | 'lastWatchedAt'>, t: Translate, now: number): string {
  if (!c.started) return t('cleanup.rule.unwatched');
  const who = c.watchedBy === 1 ? t('cleanup.watchedByOne') : c.watchedBy ? t('cleanup.watchedBy', { n: c.watchedBy }) : t('cleanup.startedNotFinished');
  if (!c.lastWatchedAt) return who;
  const a = ago(c.lastWatchedAt, now);
  return `${who} · ${t('cleanup.last', { when: t(a.key, { n: a.n }) })}`;
}

/** "HEVC · 2160p · … · Watched by 1 user · added 3 days ago · Movies". */
export function candidateFacts(c: CleanupCandidate, t: Translate, now: number): string {
  const added = ago(c.addedAt, now);
  return [c.format || (c.height ? `${c.height}p` : null), watchStatus(c, t, now), t('cleanup.added', { when: t(added.key, { n: added.n }) }), c.library].filter(Boolean).join(' · ');
}

/** When a planned deletion happens: "on 2 Dec 2026", or "as soon as deleting is allowed" once due. */
export function dueText(dueAt: number, now: number, t: Translate, locale: string): string {
  return dueAt <= now ? t('cleanup.own.overdue') : t('cleanup.own.due', { date: new Date(dueAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) });
}

/** The text of the delete confirmation: what goes, how much, and that it cannot be undone. */
export function deleteMessage(items: Pick<CleanupCandidate, 'path' | 'size'>[], t: Translate): string {
  const shown = items.slice(0, DELETE_LIST_MAX).map((c) => `• ${c.path} (${formatBytes(c.size)})`);
  if (items.length > DELETE_LIST_MAX) shown.push(t('cleanup.andMore', { n: items.length - DELETE_LIST_MAX }));
  return `${t('cleanup.deleteText', { n: items.length, size: formatBytes(totalBytes(items)) })}\n\n${shown.join('\n')}\n\n${t('cleanup.understand')}`;
}

/** What to tell after deleting: how many went, and the first few that did not. */
export function deleteOutcome(results: DeleteResult[], t: Translate): string {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const lines: string[] = [];
  if (ok.length) lines.push(t('cleanup.deleted', { n: ok.length, size: formatBytes(totalBytes(ok)) }));
  for (const f of failed.slice(0, 3)) lines.push(`${f.path ?? t('cleanup.fileN', { n: f.fileId })}: ${f.error ?? ''}`);
  if (failed.length > 3) lines.push(t('cleanup.andMore', { n: failed.length - 3 }));
  return lines.join('\n');
}

export function hasCondition(r: Pick<OwnRule, 'watched' | 'addedDays' | 'notPlayedDays' | 'minGb'>): boolean {
  return r.watched !== 'any' || r.addedDays !== null || r.notPlayedDays !== null || r.minGb !== null;
}

export function ruleValid(r: OwnRule): boolean {
  return r.name.trim().length > 0 && hasCondition(r);
}

/** "watched by everyone · added 30+ days ago · deletes after 7 days". */
export function ruleSummary(r: OwnRule, t: Translate): string {
  return [
    r.watched !== 'any' ? t(`cleanup.own.sum.${r.watched}` as MessageKey) : null,
    r.addedDays !== null ? t('cleanup.own.sum.added', { days: r.addedDays }) : null,
    r.notPlayedDays !== null ? t('cleanup.own.sum.notPlayed', { days: r.notPlayedDays }) : null,
    r.minGb !== null ? t('cleanup.own.sum.larger', { gb: r.minGb }) : null,
    r.enabled ? (r.action === 'delete' ? t('cleanup.own.deletesAfter', { days: r.graceDays }) : t('cleanup.own.suggestOnly')) : t('cleanup.off'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The rules after saving one (new: added at the end) or removing one. */
export function withRule(list: OwnRule[], index: number | null, rule: OwnRule): OwnRule[] {
  return index === null ? [...list, rule] : list.map((x, i) => (i === index ? rule : x));
}

export function withoutRule(list: OwnRule[], index: number): OwnRule[] {
  return list.filter((_, i) => i !== index);
}

/**
 * A number typed in a field: empty is null (no condition when `optional`), otherwise at least `min`
 * and at most `max`. Decimals only when `decimals`.
 */
export function numberInput(text: string, opts: { min: number; max: number; decimals?: boolean; optional?: boolean }): number | null {
  const clean = text.replace(',', '.').trim();
  if (clean === '') return opts.optional ? null : opts.min;
  const n = opts.decimals ? Number.parseFloat(clean) : Number.parseInt(clean, 10);
  if (!Number.isFinite(n)) return opts.optional ? null : opts.min;
  return Math.min(opts.max, Math.max(opts.min, opts.decimals ? Math.round(n * 10) / 10 : n));
}

/** A rule's built-in limits: whole numbers of days and GB the server accepts. */
export function clampRules(r: CleanupRules): CleanupRules {
  const days = (n: number) => Math.min(3650, Math.max(1, Math.round(n) || 1));
  return { ...r, unwatched: { ...r.unwatched, days: days(r.unwatched.days) }, stale: { ...r.stale, days: days(r.stale.days) }, large: { ...r.large, gb: Math.min(10_000, Math.max(1, r.large.gb || 1)) } };
}

// ---- backup

export type BackupKind = 'auto' | 'manual' | 'archive' | 'pre-migration' | 'pre-restore';

export interface BackupFile {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
}

export interface BackupSchedule {
  schedule: 'daily' | 'weekly' | 'off';
  hour: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
}

export interface BackupOverview {
  backups: BackupFile[];
  schedule: BackupSchedule;
  nextDue: number | null;
  pendingRestore: { source: string; requestedBy: string; requestedAt: number } | null;
  folder: string;
}

export interface BackupVerification {
  ok: boolean;
  errors: string[];
  info: { size: number; migrations: number | null; users: number | null; movies: number | null; shows: number | null } | null;
}

const KIND_KEY: Record<BackupKind, MessageKey> = {
  auto: 'backup.kind.auto',
  manual: 'backup.kind.manual',
  archive: 'backup.kind.archive',
  'pre-migration': 'backup.kind.preMigration',
  'pre-restore': 'backup.kind.preRestore',
};

export function backupKindKey(kind: BackupKind): MessageKey {
  return KIND_KEY[kind] ?? 'backup.kind.manual';
}

/** How many of each the server keeps at most (its own limits). */
export const KEEP_LIMITS = { keepDaily: { min: 1, max: 60 }, keepWeekly: { min: 0, max: 52 }, keepMonthly: { min: 0, max: 36 } } as const;

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** "Verified: 3 users, 120 movies, 14 shows" or what is wrong with it. */
export function verifyLine(r: BackupVerification, t: Translate): string {
  return r.ok ? t('backup.verified', { users: r.info?.users ?? '?', movies: r.info?.movies ?? '?', shows: r.info?.shows ?? '?' }) : r.errors.join(' ');
}

export function backupWhen(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
