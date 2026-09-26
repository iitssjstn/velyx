export type ImageSize = 'w185' | 'w342' | 'w500' | 'w780' | 'w1280';

/** Server path of cached TMDB artwork, or null. */
export function imagePath(path: string | null | undefined, size: ImageSize = 'w342'): string | null {
  if (!path) return null;
  return `/api/images/${size}/${path.replace(/^\//, '')}`;
}

/** 2h 35m / 47m */
export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** 1:05 / 1:02:03 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** S02E04 */
export function episodeCode(season: number | null, episode: number | null): string {
  if (season === null || episode === null) return '';
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

/** How far into something the user is, 0–1 (0 without progress). */
export function progressFraction(p: { positionSec: number; durationSec: number } | null | undefined): number {
  if (!p || !p.durationSec) return 0;
  return Math.min(1, Math.max(0, p.positionSec / p.durationSec));
}
