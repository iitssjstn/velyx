import { formatRuntime } from './format';

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
  /** Of a show, the seasons being fetched (empty or missing: a movie, or not known). */
  seasons?: number[];
}

/** While something is being fetched, how often its list or page asks again. */
export const DOWNLOAD_POLL_MS = 15_000;

/** A whole percentage that only reaches 100 when it is done. */
export function downloadPercent(d: Download): number {
  const pct = Math.floor(Math.min(1, Math.max(0, d.fraction)) * 100);
  return d.sizeLeft > 0 ? Math.min(99, pct) : pct;
}

/** "~25 min" until it should be done; "" when it should be done any moment; null when unknown. */
export function downloadTimeLeft(d: Download, now: number): string | null {
  if (d.eta === null || d.status === 'paused') return null;
  const minutes = Math.round((d.eta - now) / 60_000);
  return minutes < 1 ? '' : formatRuntime(minutes);
}
