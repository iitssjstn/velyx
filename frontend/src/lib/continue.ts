import type { ContinueItem } from './types';
import { formatClock } from './format';
import { playHref } from './player';

/** "Season 2 · Episode 4", "Up next · Season 2 · Episode 5", or a movie's year. */
export function continueDetail(c: ContinueItem): string | null {
  if (c.type === 'movie') return c.subtitle;
  if (c.seasonNumber === null || c.episodeNumber === null) return c.subtitle;
  const se = c.seasonNumber === 0 ? `Special ${c.episodeNumber}` : `Season ${c.seasonNumber} · Episode ${c.episodeNumber}`;
  return c.upNext ? `Up next · ${se}` : se;
}

/** "32:14 / 48:21" while in progress, nothing otherwise. */
export function continuePosition(c: ContinueItem): string | null {
  if (!c.progress || c.progress.positionSec <= 0 || c.progress.durationSec <= 0) return null;
  return `${formatClock(c.progress.positionSec)} / ${formatClock(c.progress.durationSec)}`;
}

export function isStarted(c: ContinueItem): boolean {
  return Boolean(c.progress && c.progress.positionSec > 0);
}

/** Continue where it stopped (the player starts there without asking). */
export function resumeHref(c: ContinueItem): string {
  return playHref(c.type, c.id, c.progress?.positionSec);
}

/** Play from the beginning, without the resume question. */
export function startOverHref(c: ContinueItem): string {
  return `/play/${c.type}/${c.id}?t=0`;
}
