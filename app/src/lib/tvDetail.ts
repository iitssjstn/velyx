import { episodeCode, formatRuntime } from './format';
import type { EpisodeSummary } from './types';

/** "S01E02 · 52m" under an episode on the TV detail page. */
export function episodeFacts(e: EpisodeSummary): string {
  const runtime = formatRuntime(e.runtime ?? (e.durationSec ? Math.round(e.durationSec / 60) : null));
  return [episodeCode(e.seasonNumber, e.episodeNumber), runtime].filter(Boolean).join(' · ');
}

/** The episode a season's row starts at: the one to watch next if it is in this season, else the first. */
export function startEpisode(episodes: EpisodeSummary[], upNextId: number | null | undefined): number {
  const i = upNextId == null ? -1 : episodes.findIndex((e) => e.id === upNextId);
  return Math.max(0, i);
}
