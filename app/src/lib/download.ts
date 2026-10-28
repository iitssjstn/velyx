import { formatRuntime } from './format';
import type { Translate } from './i18n';

/** How far fetching a requested title is (from Sonarr or Radarr, through Seerr and the server). */
export interface Download {
  /** 0 to 1. */
  fraction: number;
  size: number;
  sizeLeft: number;
  /** When it should be done (ms), null when unknown. */
  eta: number | null;
  status: 'downloading' | 'queued' | 'paused' | 'warning';
  items: number;
}

/** While something is being fetched, how often its list or page asks again. */
export const DOWNLOAD_POLL_MS = 15_000;

/** A whole percentage that only reaches 100 when it is done. */
export function downloadPercent(d: Download): number {
  const pct = Math.floor(Math.min(1, Math.max(0, d.fraction)) * 100);
  return d.sizeLeft > 0 ? Math.min(99, pct) : pct;
}

/** "Fetching 42% · ~25m left · 3 files", in the words of the app's language. */
export function downloadLine(d: Download, now: number, t: Translate): string {
  const pct = downloadPercent(d);
  const minutes = d.eta === null || d.status === 'paused' ? null : Math.round((d.eta - now) / 60_000);
  return [
    d.status === 'downloading' ? t('download.downloading', { pct }) : d.status === 'warning' ? t('download.warning', { pct }) : t(d.status === 'paused' ? 'download.paused' : 'download.queued'),
    minutes === null ? null : minutes < 1 ? t('download.almost') : t('download.left', { time: formatRuntime(minutes) ?? '' }),
    d.items > 1 ? t('download.files', { n: d.items }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
