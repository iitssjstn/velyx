import { t, type MessageKey } from '../i18n';
import { episodeCode, formatClock } from './format';
import { playHref, resumePoint } from './player';
import type { EpisodeSummary, ShowDetail } from './types';

/** "S02E04 · The Beginning" (just the code when the episode has no title). */
export function episodeHeading(ep: Pick<EpisodeSummary, 'seasonNumber' | 'episodeNumber' | 'title'>): string {
  return `${episodeCode(ep.seasonNumber, ep.episodeNumber)}${ep.title ? ` · ${ep.title}` : ''}`;
}

/** Where an episode stands for this user: watched, partly watched (with %), or not started. */
export function episodeState(ep: Pick<EpisodeSummary, 'progress'>): { kind: 'watched' | 'progress' | 'new'; percent: number } {
  const p = ep.progress;
  if (p?.completed) return { kind: 'watched', percent: 100 };
  if (p && p.positionSec >= 30 && p.durationSec > 0) return { kind: 'progress', percent: Math.min(99, Math.max(1, Math.round((p.positionSec / p.durationSec) * 100))) };
  return { kind: 'new', percent: 0 };
}

/** Play or resume an episode straight from the list, without a question in between. */
export function episodePlayHref(ep: Pick<EpisodeSummary, 'id' | 'progress'>): string {
  const at = resumePoint(ep.progress);
  return at !== null ? playHref('episode', ep.id, at) : `/play/episode/${ep.id}?t=0`;
}

export interface ContinueAction {
  label: string;
  href: string;
  /** Only when resuming: play the episode from the beginning. */
  startOverHref: string | null;
  /** "32:14 / 48:21" when resuming. */
  position: string | null;
}

/** The series page's main button: resume, play the next episode, start, or watch again. */
export function seriesContinue(show: Pick<ShowDetail, 'upNext' | 'watchedCount' | 'episodeCount'>): ContinueAction | null {
  const up = show.upNext;
  if (!up) return null;
  const code = episodeCode(up.seasonNumber, up.episodeNumber);
  const p = up.progress;
  if (p && resumePoint(p) !== null) {
    const total = p.durationSec || up.durationSec || 0;
    return { label: t('series.resumeCode', { code }), href: playHref('episode', up.id, p.positionSec), startOverHref: `/play/episode/${up.id}?t=0`, position: total ? `${formatClock(p.positionSec)} / ${formatClock(total)}` : null };
  }
  const all = show.episodeCount > 0 && show.watchedCount >= show.episodeCount;
  const label = all ? t('series.watchAgainFrom', { code }) : show.watchedCount > 0 ? t('series.playNextCode', { code }) : t('series.playCode', { code });
  return { label, href: `/play/episode/${up.id}?t=0`, startOverHref: null, position: null };
}

/** A season's name: generated and TMDB names ("Season 2", "Specials") in the interface language. */
export function seasonName(s: { seasonNumber: number; name: string }): string {
  if (s.seasonNumber === 0 && (!s.name || /^specials$/i.test(s.name))) return t('series.specials');
  if (!s.name || new RegExp(`^season\\s*${s.seasonNumber}$`, 'i').test(s.name)) return t('series.season', { n: s.seasonNumber });
  return s.name;
}

const STATUSES: Record<string, MessageKey> = {
  'Returning Series': 'series.status.returning',
  Ended: 'series.status.ended',
  Canceled: 'series.status.canceled',
  'In Production': 'series.status.inProduction',
  Planned: 'series.status.planned',
  Pilot: 'series.status.pilot',
};

/** A show's status from TMDB ("Returning Series") in the interface language. */
export function showStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUSES[status] ? t(STATUSES[status]) : status;
}
