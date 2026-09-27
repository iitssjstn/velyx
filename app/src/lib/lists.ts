/**
 * Watchlist, favorites and watched: the requests the app sends. The server is the only source of
 * truth; the app changes what it shows right away and then loads it again from the server.
 */

export type SavedList = 'watchlist' | 'favorites';
export type Kind = 'movie' | 'show';

export interface ApiRequest {
  method: 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

/** Adds a movie or show to a list, or removes it. */
export function savedRequest(list: SavedList, kind: Kind, id: number, on: boolean): ApiRequest {
  if (on) return { method: 'POST', path: `/api/${list}`, body: kind === 'movie' ? { movieId: id } : { showId: id } };
  return { method: 'DELETE', path: `/api/${list}/${kind}/${id}` };
}

/** What can be marked as watched or unwatched. */
export type WatchedTarget = { movieId: number } | { episodeId: number } | { seasonId: number } | { showId: number };

export function watchedRequest(target: WatchedTarget, watched: boolean): ApiRequest {
  return { method: 'POST', path: '/api/progress/watched', body: { ...target, watched } };
}

/** Whether a search is worth sending: two or more characters (a code such as "s2" counts too). */
export function searchQuery(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ').slice(0, 100);
  return q.length >= 2 ? q : null;
}
