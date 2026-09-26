import { episodeCode, formatClock } from './format';
import { playHref } from './player';
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
  const state = episodeState(ep);
  return state.kind === 'progress' ? playHref('episode', ep.id, ep.progress!.positionSec) : `/play/episode/${ep.id}?t=0`;
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
  if (p && !p.completed && p.positionSec >= 30) {
    const total = p.durationSec || up.durationSec || 0;
    return { label: `Resume ${code}`, href: playHref('episode', up.id, p.positionSec), startOverHref: `/play/episode/${up.id}?t=0`, position: total ? `${formatClock(p.positionSec)} / ${formatClock(total)}` : null };
  }
  const all = show.episodeCount > 0 && show.watchedCount >= show.episodeCount;
  const label = all ? `Watch again from ${code}` : show.watchedCount > 0 ? `Play next ${code}` : `Play ${code}`;
  return { label, href: `/play/episode/${up.id}?t=0`, startOverHref: null, position: null };
}
