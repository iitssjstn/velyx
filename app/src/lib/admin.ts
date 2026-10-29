/**
 * The Admin tab of the app (phones and tablets, administrators only): the shapes of the server's admin
 * API it uses (the same as the website's Admin) and what may be done with each item.
 */

import type { Download } from './download';
import type { Translate } from './i18n';

export interface AdminStream {
  id: string;
  username: string;
  title: string;
  subtitle: string | null;
  mode: 'direct' | 'remux' | 'transcode';
  device: string | null;
  positionSec: number | null;
  durationSec: number | null;
}

export interface ScanState {
  status: 'scanning' | 'queued' | 'paused' | 'failed' | 'idle';
  running: { libraryId: number; progress: { processed?: number; total?: number } | null } | null;
  paused: { reason: 'manual' | 'low-disk'; since: number } | null;
}

export interface Disk {
  total: number;
  free: number;
  used: number;
  level: 'ok' | 'low' | 'critical';
}

export interface AdminDashboard {
  version: string;
  serverName: string;
  uptimeSec: number;
  cpu: { system: number | null; velyx: number | null };
  streams: AdminStream[];
  /** Where Vidalune keeps its own data. */
  disk: Disk | null;
  /** Where the films and series are: one per disk, with the libraries on it (missing on older servers). */
  mediaDisks?: Array<Disk & { libraries: Array<{ id: number; name: string }> }>;
  update: { current: string; latest: string | null; available: boolean };
  counts: { movies: number; shows: number; episodes: number; users: number; needsReview: number };
  scan: ScanState;
}

export interface AdminLibrary {
  id: number;
  name: string;
  type: 'movies' | 'shows';
  itemCount: number;
  available: boolean;
  scanning: unknown | null;
  queued: boolean;
  lastScanAt: number | null;
  lastScanStatus: 'ok' | 'error' | 'running' | 'empty' | null;
}

export type RequestState = 'requested' | 'approved' | 'processing' | 'available' | 'partiallyAvailable' | 'declined' | 'failed' | 'removed';

export interface AdminRequest {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  state: RequestState;
  /** How far fetching it is (null: nothing is being fetched; absent from an older server). */
  download?: Download | null;
  createdAt: number;
  user: string | null;
}

export type OptimizationStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'stale' | 'paused';

export interface OptimizationItem {
  id: number;
  fileId: number;
  profile: 'compat-720p' | 'compat-1080p';
  status: OptimizationStatus;
  progress: number;
  position: number | null;
  error: string | null;
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  lastLoginAt: number | null;
  seerrAccess: boolean;
}

export interface AdminNotification {
  id: number;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

export interface HistoryItem {
  id: number;
  username: string;
  title: string;
  subtitle: string | null;
  startedAt: number;
  watchedSec: number;
  device: string | null;
}

/** The Admin tab: only for administrators, and not on a TV (no typing or confirming there). */
export function showsAdminTab(user: { role: string } | null, tv: boolean): boolean {
  return !tv && user?.role === 'admin';
}

export type RequestAction = 'approve' | 'decline' | 'cancel';

/** What an administrator can do with a request: one waiting for approval can be approved or declined. */
export function requestActions(state: RequestState): RequestAction[] {
  if (state === 'requested') return ['approve', 'decline', 'cancel'];
  if (state === 'available' || state === 'removed') return [];
  return ['cancel'];
}

/** Stop a copy that waits or is being made; start again one that was stopped, failed or is outdated. */
export function optimizationAction(status: OptimizationStatus): 'stop' | 'resume' | null {
  if (status === 'queued' || status === 'processing') return 'stop';
  if (status === 'paused' || status === 'failed' || status === 'stale') return 'resume';
  return null;
}

/** "Breaking Bad · S01E02" or "The Matrix (1999)". */
export function optimizationTitle(item: Pick<OptimizationItem, 'title' | 'year' | 'season' | 'episode'>): string {
  const title = item.title ?? '—';
  if (item.season !== null && item.episode !== null) return `${title} · S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
  return item.year ? `${title} (${item.year})` : title;
}

/** Administrators cannot block themselves (the server refuses it too). */
export function canBlock(user: Pick<AdminUser, 'id'>, me: { id: number } | null): boolean {
  return me !== null && user.id !== me.id;
}

/** "1.2 GB", "820 MB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i += 1;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** How full the disk is, 0 to 1. */
export function diskUsed(disk: Disk | null): number | null {
  if (!disk || disk.total <= 0) return null;
  return Math.min(1, Math.max(0, disk.used / disk.total));
}

export interface StorageMeter {
  key: string;
  label: string;
  /** 0 to 1. */
  fraction: number;
  free: number;
  /** Getting full (low or critical). */
  warn: boolean;
}

/**
 * The storage bars of the Admin tab: Vidalune's own storage, then one per disk the libraries are on
 * ("Library: Movies, Shows"). A disk whose size is unknown is left out.
 */
export function storageMeters(d: Pick<AdminDashboard, 'disk' | 'mediaDisks'>, t: Translate): StorageMeter[] {
  const meter = (key: string, label: string, disk: Disk | null): StorageMeter[] => {
    const fraction = diskUsed(disk);
    return disk && fraction !== null ? [{ key, label, fraction, free: disk.free, warn: disk.level !== 'ok' }] : [];
  };
  return [
    ...meter('vidalune', t('admin.vidaluneStorage'), d.disk),
    ...(d.mediaDisks ?? []).flatMap((m) => meter(`library-${m.libraries[0]?.id ?? 0}`, t('admin.libraryStorage', { names: m.libraries.map((l) => l.name).join(', ') }), m)),
  ];
}

/** "2 d 4 h", "3 h 12 min", "8 min". */
export function uptime(sec: number): string {
  const min = Math.floor(sec / 60);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} d ${h % 24} h`;
  if (h > 0) return `${h} h ${min % 60} min`;
  return `${min} min`;
}
