/**
 * Admin → Log, Audit log, Metadata and Intros and credits in the app: the shapes of the server's
 * admin API (the same as the website's) and what the screens show of them.
 */

import type { Language, Translate } from './i18n';

/** One line of the server's recent log (GET /api/admin/logs). */
export interface LogEntry {
  time: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  stack?: string;
}

export type LogLevel = 'all' | 'warn' | 'error';

/** The lines at this level or worse, holding the text (in the message or the module), newest first. */
export function filterLogs(entries: LogEntry[], level: LogLevel, text: string): LogEntry[] {
  const f = text.trim().toLowerCase();
  return entries
    .filter((l) => (level === 'all' ? true : level === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error'))
    .filter((l) => !f || l.message.toLowerCase().includes(f) || l.module.toLowerCase().includes(f))
    .slice()
    .reverse();
}

/** One event of the audit log (GET /api/admin/audit). */
export interface AuditEntry {
  id: number;
  at: number;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The groups to filter on, as on the website: what the action starts with. */
export const AUDIT_GROUPS = ['', 'login.', 'user.', 'session.', 'library.', 'cleanup.', 'settings.updated', 'tmdb.updated', 'backup.', 'subtitles.'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

export const AUDIT_PAGE = 50;

export function auditPath(page: number, group: AuditGroup): string {
  const params = new URLSearchParams({ page: String(page), limit: String(AUDIT_PAGE) });
  if (group) params.set('action', group);
  return `/api/admin/audit?${params.toString()}`;
}

/** What happened, in words (the website's texts); an action this app does not know yet shows as it is. */
export function auditLabel(action: string, lang: Language): string {
  return AUDIT_ACTIONS[action]?.[lang] ?? action;
}

const AUDIT_ACTIONS: Record<string, Record<Language, string>> = {
  'login.success': { en: 'Signed in', nl: 'Ingelogd' },
  'login.failed': { en: 'Failed sign-in', nl: 'Mislukte inlogpoging' },
  'login.blocked': { en: 'Sign-in throttled', nl: 'Inloggen tijdelijk geblokkeerd' },
  'logout': { en: 'Signed out', nl: 'Uitgelogd' },
  'setup.completed': { en: 'Completed setup', nl: 'Installatie voltooid' },
  'user.created': { en: 'Created user', nl: 'Gebruiker aangemaakt' },
  'user.updated': { en: 'Changed user', nl: 'Gebruiker gewijzigd' },
  'user.deleted': { en: 'Deleted user', nl: 'Gebruiker verwijderd' },
  'user.password_reset': { en: 'Reset password of', nl: 'Wachtwoord opnieuw ingesteld van' },
  'account.password_changed': { en: 'Changed own password', nl: 'Eigen wachtwoord gewijzigd' },
  'device.linked': { en: 'Connected the Vidalune app on', nl: 'Koppelde de Vidalune-app op' },
  'session.revoked': { en: 'Revoked a session of', nl: 'Een sessie ingetrokken van' },
  'session.revoked_all': { en: 'Revoked all sessions of', nl: 'Alle sessies ingetrokken van' },
  'library.created': { en: 'Created library', nl: 'Bibliotheek aangemaakt' },
  'library.updated': { en: 'Changed library', nl: 'Bibliotheek gewijzigd' },
  'library.deleted': { en: 'Deleted library', nl: 'Bibliotheek verwijderd' },
  'library.scan': { en: 'Started a scan of', nl: 'Scan gestart van' },
  'scans.paused': { en: 'Paused scanning', nl: 'Scannen gepauzeerd' },
  'scans.resumed': { en: 'Resumed scanning', nl: 'Scannen hervat' },
  'metadata.matched': { en: 'Changed the match of', nl: 'Koppeling gewijzigd van' },
  'metadata.refreshed': { en: 'Refreshed metadata of', nl: 'Metadata vernieuwd van' },
  'settings.updated': { en: 'Changed server settings', nl: 'Serverinstellingen gewijzigd' },
  'tmdb.updated': { en: 'Changed TMDB settings', nl: 'TMDB-instellingen gewijzigd' },
  'backup.created': { en: 'Created a backup', nl: 'Back-up gemaakt' },
  'backup.downloaded': { en: 'Downloaded a backup', nl: 'Back-up gedownload' },
  'backup.deleted': { en: 'Deleted backup', nl: 'Back-up verwijderd' },
  'database.restored': { en: 'Restored the database', nl: 'Database teruggezet' },
  'cache.cleared': { en: 'Cleared cache', nl: 'Cache gewist' },
  'collection.created': { en: 'Created collection', nl: 'Collectie aangemaakt' },
  'collection.deleted': { en: 'Deleted collection', nl: 'Collectie verwijderd' },
  'cleanup.deleted': { en: 'Deleted a file during clean-up', nl: 'Bestand verwijderd bij opschonen' },
  'cleanup.kept': { en: 'Kept files in clean-up', nl: 'Bestanden bewaard bij opschonen' },
  'cleanup.settings': { en: 'Changed clean-up settings', nl: 'Opschooninstellingen gewijzigd' },
  'cleanup.rules': { en: 'Changed own clean-up rules', nl: 'Eigen opschoonregels gewijzigd' },
  'notifications.settings': { en: 'Changed notification settings', nl: 'Meldingsinstellingen gewijzigd' },
  'cloud.linking': { en: 'Started linking to a Vidalune account', nl: 'Koppelen aan Vidalune-account gestart' },
  'cloud.unlinked': { en: 'Unlinked from the Vidalune account', nl: 'Ontkoppeld van het Vidalune-account' },
  'cloud.relay_on': { en: 'Turned the Vidalune relay on', nl: 'Vidalune-relay aangezet' },
  'cloud.relay_off': { en: 'Turned the Vidalune relay off', nl: 'Vidalune-relay uitgezet' },
  'cloud.home_networks': { en: 'Changed the home networks', nl: 'Thuisnetwerken gewijzigd' },
  'seerr.settings': { en: 'Changed the Seerr connection', nl: 'Seerr-koppeling gewijzigd' },
  'seerr.requested': { en: 'Requested through Seerr', nl: 'Aangevraagd via Seerr' },
  'seerr.cancelled': { en: 'Cancelled a Seerr request', nl: 'Seerr-aanvraag geannuleerd' },
  'seerr.approved': { en: 'Approved a Seerr request', nl: 'Seerr-aanvraag goedgekeurd' },
  'seerr.declined': { en: 'Declined a Seerr request', nl: 'Seerr-aanvraag afgewezen' },
  'seerr.reset': { en: 'Made a title requestable again (Seerr)', nl: 'Titel opnieuw aanvraagbaar gemaakt (Seerr)' },
  'direct.port_changed': { en: 'Changed the public media port', nl: 'Publieke mediaspoort gewijzigd' },
  'invite.created': { en: 'Made an invitation', nl: 'Uitnodiging gemaakt' },
  'invite.revoked': { en: 'Withdrew an invitation', nl: 'Uitnodiging ingetrokken' },
  'invite.used': { en: 'Joined through an invitation', nl: 'Via een uitnodiging binnengekomen' },
  'cloud.account_linked': { en: 'Connected a Vidalune account', nl: 'Vidalune-account gekoppeld' },
  'segments.analyze': { en: 'Started intro and credits detection for', nl: 'Herkenning van intro en aftiteling gestart voor' },
  'segments.edited': { en: 'Edited intro and credits of', nl: 'Intro en aftiteling bewerkt van' },
  'segments.reset': { en: 'Reset intro and credits of', nl: 'Intro en aftiteling hersteld van' },
  'subtitles.settings': { en: 'OpenSubtitles settings changed', nl: 'OpenSubtitles-instellingen gewijzigd' },
  'subtitles.downloaded': { en: 'Subtitle fetched online', nl: 'Ondertiteling online opgehaald' },
  'subtitles.removed': { en: 'Fetched subtitle removed', nl: 'Opgehaalde ondertiteling verwijderd' },
};

/** A movie or show the server could not recognise for sure (GET /api/admin/review). */
export interface ReviewItem {
  id: number;
  type: 'movie' | 'show';
  title: string;
  parsedTitle: string;
  parsedYear: number | null;
  status: string;
  confidence: number | null;
  samplePath: string | null;
}

/** Both lists together, the least sure first. */
export function reviewList(r: { movies: ReviewItem[]; shows: ReviewItem[] } | undefined): ReviewItem[] {
  if (!r) return [];
  return [...r.movies, ...r.shows].sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1) || a.title.localeCompare(b.title));
}

/** The file name of a path, for the line under a title (no folders shown). */
export function fileName(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/** Intros and credits: how the detection is doing (GET /api/admin/segments). */
export interface SegmentStatus {
  enabled: boolean;
  state: 'idle' | 'running' | 'waiting' | 'disabled';
  waitingFor: 'playback' | 'scan' | null;
  running: { showId: number; showTitle: string; seasonNumber: number; done: number; total: number } | null;
  queuedSeasons: number;
  counts: { episodes: number; analyzed: number; recaps?: number; intros: number; credits: number; pending: number; errors: number; manual: number; lowConfidence: number; reports?: number };
}

export interface SegmentShow {
  id: number;
  title: string;
  episodes: number;
  analyzed: number;
  recaps?: number;
  intros: number;
  credits: number;
  errors: number;
  manual: number;
  low: number;
}

export interface SegmentOverview {
  status: SegmentStatus;
  shows: SegmentShow[];
  errors: { episodeId: number; error: string | null; detectedAt: number; showId: number; showTitle: string; seasonNumber: number; episodeNumber: number }[];
}

export type Confidence = 'high' | 'medium' | 'low';
export type SegmentSource = 'chapters' | 'video' | 'audio' | 'manual' | 'shared' | 'central';

export interface Part {
  start: number;
  end: number;
  confidence: Confidence | null;
  source?: SegmentSource | null;
}

export interface EpisodeSegments {
  status: 'analyzed' | 'error';
  error: string | null;
  recap?: Part | null;
  intro: Part | null;
  credits: Part | null;
  postCredits: Part | null;
  manual: boolean;
  detectedAt: number;
}

export type ReportKind = 'recap' | 'intro' | 'credits';
export type ReportProblem = 'starts-early' | 'starts-late' | 'ends-early' | 'ends-late' | 'not-there' | 'missing';

export interface SegmentReport {
  id: number;
  kind: ReportKind;
  problem: ReportProblem;
  position: number | null;
  createdAt: number;
  user: string;
}

export interface SegmentEpisode {
  id: number;
  episodeNumber: number;
  title: string | null;
  duration: number | null;
  eligible: boolean;
  segments: EpisodeSegments | null;
  reports?: SegmentReport[];
}

export interface ShowSegments {
  show: { id: number; title: string };
  seasons: { seasonNumber: number; episodes: SegmentEpisode[] }[];
}

/** How far the detection is: a fraction of the episodes looked at. */
export function analyzedFraction(s: Pick<SegmentShow, 'episodes' | 'analyzed'>): number {
  return s.episodes > 0 ? Math.min(1, s.analyzed / s.episodes) : 0;
}

/** The shows that need a look first: errors and unsure parts, then the least done. */
export function segmentShowsByNeed(shows: SegmentShow[]): SegmentShow[] {
  return shows.slice().sort((a, b) => b.errors + b.low - (a.errors + a.low) || analyzedFraction(a) - analyzedFraction(b) || a.title.localeCompare(b.title));
}

export type AnalyzeScope = { scope: 'all' } | { scope: 'show'; showId: number } | { scope: 'season'; showId: number; seasonNumber: number } | { scope: 'episode'; episodeId: number };

/** The open reports of a show, with the episode they are about. */
export function openReports(s: ShowSegments | undefined): { report: SegmentReport; seasonNumber: number; episode: SegmentEpisode }[] {
  if (!s) return [];
  return s.seasons.flatMap((season) => season.episodes.flatMap((episode) => (episode.reports ?? []).map((report) => ({ report, seasonNumber: season.seasonNumber, episode }))));
}

/** What the detection is doing now, in one line. */
export function statusLine(s: SegmentStatus, t: Translate): string {
  if (!s.enabled || s.state === 'disabled') return t('segments.off');
  if (s.state === 'running' && s.running) return t('segments.running', { show: s.running.showTitle, season: s.running.seasonNumber, done: s.running.done, total: s.running.total });
  if (s.state === 'waiting') return s.waitingFor === 'scan' ? t('segments.waitingScan') : t('segments.waitingPlayback');
  return s.counts.pending > 0 ? t('segments.pending', { n: s.counts.pending }) : t('segments.upToDate');
}

