/** One viewing in the watch history (GET /api/account/history). */
export interface WatchedEntry {
  id: number;
  kind: 'movie' | 'episode';
  movieId: number | null;
  episodeId: number | null;
  showId: number | null;
  title: string;
  subtitle: string | null;
  device: string | null;
  startedAt: number;
  watchedSec: number;
}

/** Where a viewing opens: the movie, or the show of an episode; nothing when it is gone. */
export function historyTarget(h: Pick<WatchedEntry, 'kind' | 'movieId' | 'showId'>): `/movie/${number}` | `/show/${number}` | null {
  if (h.kind === 'movie') return h.movieId ? `/movie/${h.movieId}` : null;
  return h.showId ? `/show/${h.showId}` : null;
}
