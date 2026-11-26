import type { MessageKey } from './i18n';

/** A library as `GET /api/libraries` gives it. */
export interface LibraryRow {
  id: number;
  name: string;
  type: 'movies' | 'shows';
  path: string;
  itemCount: number;
  fileCount: number;
  available: boolean;
  scanning: { phase: string; processed: number; total: number } | null;
  queued: boolean;
  watching?: boolean;
  watchError?: string | null;
  lastScanAt: number | null;
  lastScanStatus: 'ok' | 'error' | 'running' | 'empty' | null;
  lastScanMessage: string | null;
}

export interface LibraryList {
  libraries: LibraryRow[];
  mediaRoots: string[];
}

/** `GET /api/libraries/folders`: `path` null = the media roots themselves. */
export interface FolderList {
  path: string | null;
  parent: string | null;
  folders: { name: string; path: string; readable: boolean }[];
}

export interface LibraryIssues {
  unrecognized: { id: number; path: string }[];
  failed: { id: number; path: string; error: string | null }[];
}

export interface LibraryForm {
  name: string;
  type: 'movies' | 'shows';
  path: string;
}

/** Where a new library's folder starts: inside the first media root. */
export function defaultFolder(roots: string[]): string {
  return roots[0] ? `${roots[0].replace(/\/+$/, '')}/` : '';
}

const clean = (p: string) => p.trim().replace(/\/+$/, '') || '/';

/** True when the folder is a whole media root (the website warns: that may hold many libraries). */
export function isMediaRoot(path: string, roots: string[]): boolean {
  if (!path.trim()) return false;
  return roots.some((r) => clean(r) === clean(path));
}

/** What is missing before saving, or null. The server checks the folder itself. */
export function formProblem(form: LibraryForm): MessageKey | null {
  if (!form.name.trim()) return 'libraries.nameNeeded';
  if (form.name.trim().length > 64) return 'libraries.nameTooLong';
  if (!form.path.trim()) return 'libraries.folderNeeded';
  return null;
}

/** The request that saves the form: POST for a new library, PUT (name and folder only) for one that exists. */
export function saveRequest(form: LibraryForm, id: number | null): { method: 'post' | 'put'; path: string; body: Record<string, string> } {
  const name = form.name.trim();
  const path = form.path.trim();
  return id === null ? { method: 'post', path: '/api/libraries', body: { name, type: form.type, path } } : { method: 'put', path: `/api/libraries/${id}`, body: { name, path } };
}

/** The folder list to ask for (null = the media roots). */
export function foldersPath(at: string | null): string {
  return at ? `/api/libraries/folders?path=${encodeURIComponent(at)}` : '/api/libraries/folders';
}

/** Where the folder picker opens: the typed folder without trailing slashes, or the roots. */
export function pickerStart(path: string): string | null {
  return path.trim().replace(/\/+$/, '') || null;
}

/** The library id from `?id=` (null = a new library). */
export function libraryId(param: string | string[] | undefined): number | null {
  const raw = Array.isArray(param) ? param[0] : param;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

export type ScanKind = 'new' | 'metadata' | 'full' | 'confirmEmpty';

/** Body of `POST /api/libraries/:id/scan` for each kind of scan. */
export function scanBody(kind: ScanKind): Record<string, boolean> {
  if (kind === 'metadata') return { refreshMetadata: true };
  if (kind === 'full') return { full: true };
  if (kind === 'confirmEmpty') return { confirmEmpty: true };
  return {};
}

export type LibraryState = 'scanning' | 'queued' | 'empty' | 'error' | 'ok' | 'never';

/** What the status line of a library says (same order as the website). */
export function libraryState(l: Pick<LibraryRow, 'scanning' | 'queued' | 'lastScanStatus' | 'lastScanAt'>): LibraryState {
  if (l.scanning) return 'scanning';
  if (l.queued) return 'queued';
  if (l.lastScanStatus === 'empty') return 'empty';
  if (l.lastScanStatus === 'error') return 'error';
  return l.lastScanAt ? 'ok' : 'never';
}

/** Scan progress 0..1, or null while the total is not known. */
export function scanFraction(l: Pick<LibraryRow, 'scanning'>): number | null {
  return l.scanning && l.scanning.total > 0 ? Math.min(1, l.scanning.processed / l.scanning.total) : null;
}

const PHASES: Record<string, MessageKey> = {
  discovering: 'libraries.phase.discovering',
  analyzing: 'libraries.phase.analyzing',
  cleaning: 'libraries.phase.cleaning',
  metadata: 'libraries.phase.metadata',
  done: 'libraries.phase.done',
};

export function phaseKey(phase: string): MessageKey {
  return PHASES[phase] ?? 'libraries.phase.scanning';
}

const SUMMARY: Record<string, MessageKey> = {
  files: 'libraries.summary.files',
  added: 'libraries.summary.added',
  removed: 'libraries.summary.removed',
  'need review': 'libraries.summary.needReview',
  'not recognized': 'libraries.summary.notRecognized',
  failed: 'libraries.summary.failed',
};

/** The stored scan summary ("120 files, 3 added") in the app's language; unknown parts stay as they are. */
export function scanSummary(message: string, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  return message
    .split(', ')
    .map((part) => {
      const m = /^(\d+) (.+)$/.exec(part);
      return m && SUMMARY[m[2]] ? t(SUMMARY[m[2]], { n: Number(m[1]) }) : part;
    })
    .join(', ');
}

/** A file path shown inside its library (without the library folder in front). */
export function insideLibrary(path: string, libraryPath: string): string {
  const base = libraryPath.replace(/\/+$/, '');
  return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

// ------------------------------------------------------------------ library health

export interface HealthCategory {
  key: string;
  label: string;
  group: 'playback' | 'formats' | 'library';
  unit: 'files' | 'items';
  description: string;
  count: number;
}

export interface HealthSummary {
  categories: HealthCategory[];
  files: number;
  totals?: { movies: number; shows: number; episodes: number; bytes: number };
  tmdbConfigured: boolean;
  analysis: { running: boolean; done: number; total: number; failed: number };
}

export interface HealthItem {
  kind: 'movie' | 'episode' | 'show';
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  library: string;
  file: { id: number; path: string; size: number; summary: string } | null;
  reasons: string[];
}

export const HEALTH_PAGE_SIZE = 50;

export const HEALTH_GROUPS: { key: HealthCategory['group']; title: MessageKey; hint: MessageKey }[] = [
  { key: 'playback', title: 'health.playback', hint: 'health.playbackHint' },
  { key: 'formats', title: 'health.formats', hint: 'health.formatsHint' },
  { key: 'library', title: 'health.library', hint: 'health.libraryHint' },
];

/** Categories that are a problem when not empty. */
const ATTENTION = new Set(['unsupported', 'scan-errors', 'missing-metadata', 'missing-artwork', 'duplicates']);

export function needsAttention(c: Pick<HealthCategory, 'key' | 'count'>): boolean {
  return ATTENTION.has(c.key) && c.count > 0;
}

/** Colour name per playback category (others: none). */
export function playbackTone(key: string): 'ok' | 'accent' | 'warn' | 'danger' | null {
  return ({ direct: 'ok', remux: 'accent', 'browser-dependent': 'warn', unsupported: 'danger' } as const)[key as 'direct'] ?? null;
}

/** Playback categories with files, each with its share of all files (for the bar). */
export function playbackShares(categories: HealthCategory[], files: number): { key: string; share: number }[] {
  if (!files) return [];
  return categories.filter((c) => c.group === 'playback' && c.count > 0).map((c) => ({ key: c.key, share: c.count / files }));
}

export function healthSummaryPath(library: number | null): string {
  return `/api/admin/health${library ? `?libraryId=${library}` : ''}`;
}

export function healthListPath(key: string, page: number, library: number | null): string {
  return `/api/admin/health/${encodeURIComponent(key)}?page=${page}&limit=${HEALTH_PAGE_SIZE}${library ? `&libraryId=${library}` : ''}`;
}

export function healthPages(total: number): number {
  return Math.max(1, Math.ceil(total / HEALTH_PAGE_SIZE));
}

/** The app screen for a health item: the server gives website links (`/movies/3`, `/shows/4`). */
export function healthTarget(href: string): string | null {
  const m = /^\/(movies|shows)\/(\d+)$/.exec(href);
  if (!m) return null;
  return `/${m[1] === 'movies' ? 'movie' : 'show'}/${m[2]}`;
}

/** Files scanned before bit depth and HDR were recorded. */
export function notAnalyzed(categories: HealthCategory[]): number {
  return categories.find((c) => c.key === 'not-analyzed')?.count ?? 0;
}

// ------------------------------------------------------------------ scan settings

/** The scan fields of `GET /api/admin/settings`. */
export interface ScanSettingsData {
  scanIntervalMinutes: number;
  scanIntervalSource: 'settings' | 'environment';
  scanIntervalDefault: number;
  watchFolders: boolean;
  scanOnStartup: boolean;
  deferScansWhilePlaying: boolean;
}

/** `interval` '' = the default from the environment (SCAN_INTERVAL_MINUTES). */
export interface ScanForm {
  interval: string;
  watchFolders: boolean;
  scanOnStartup: boolean;
  deferScansWhilePlaying: boolean;
}

export const SCAN_INTERVALS = [0, 60, 180, 360, 720, 1440];

export function scanForm(s: ScanSettingsData): ScanForm {
  return {
    interval: s.scanIntervalSource === 'settings' ? String(s.scanIntervalMinutes) : '',
    watchFolders: s.watchFolders,
    scanOnStartup: s.scanOnStartup,
    deferScansWhilePlaying: s.deferScansWhilePlaying,
  };
}

/** The interval choices: the default, the usual ones, and a custom one already saved. */
export function intervalChoices(current: string): string[] {
  const list = ['', ...SCAN_INTERVALS.map(String)];
  return current !== '' && !list.includes(current) ? [...list, current] : list;
}

/** "Off", "Every 3 hours", "Every 2 days", "Every 45 minutes". */
export function intervalText(minutes: number): { key: MessageKey; n: number } {
  if (minutes <= 0) return { key: 'libraries.interval.off', n: 0 };
  if (minutes % 1440 === 0) return { key: 'libraries.interval.days', n: minutes / 1440 };
  if (minutes % 60 === 0) return { key: 'libraries.interval.hours', n: minutes / 60 };
  return { key: 'libraries.interval.minutes', n: minutes };
}

/** What the panel sends: only its own fields that changed (the interval '' becomes null = default). */
export function scanChanges(saved: ScanForm, form: ScanForm): Record<string, boolean | number | null> {
  const out: Record<string, boolean | number | null> = {};
  if (form.interval !== saved.interval) out.scanIntervalMinutes = form.interval === '' ? null : Number(form.interval);
  for (const k of ['watchFolders', 'scanOnStartup', 'deferScansWhilePlaying'] as const) if (form[k] !== saved[k]) out[k] = form[k];
  return out;
}
