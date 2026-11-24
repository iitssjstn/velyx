/**
 * The administrator's actions on a movie or show page (as the website's ⋯ menu): refresh its
 * metadata from TMDB, pick the right TMDB entry, and put it in a collection. The server's admin API
 * does the work; these are the requests and what follows from the answers.
 */

import type { ApiRequest } from './lists';
import type { MessageKey } from './i18n';

export type TitleType = 'movie' | 'show';

/** What the server knows of how a title was recognised (in a movie's or show's details). */
export interface MatchInfo {
  status: 'pending' | 'matched' | 'unmatched' | 'manual';
  confidence: number | null;
  parsedTitle: string;
  parsedYear: number | null;
}

/** A collection a title belongs to: a movie series (auto) or one an administrator made (manual). */
export interface CollectionRef {
  id: number;
  name: string;
  kind: 'auto' | 'manual';
}

/** One TMDB entry to choose from (GET /api/admin/match/search). */
export interface MatchCandidate {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  popularity: number;
  confidence: number;
}

/** The menu is for administrators only, on the phone and on the TV alike. */
export function managesTitles(user: { role: string } | null | undefined): boolean {
  return user?.role === 'admin';
}

/** Only digits, at most four, as typed in the year field. */
export function yearInput(text: string): string {
  return text.replace(/\D/g, '').slice(0, 4);
}

/** The search for TMDB entries; a year the server would refuse is left out. */
export function matchSearchPath(type: TitleType, query: string, year: string): string | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const params = new URLSearchParams({ type, query: q.slice(0, 200) });
  const y = Number(year);
  if (/^\d{4}$/.test(year) && y >= 1870 && y <= 2100) params.set('year', year);
  return `/api/admin/match/search?${params.toString()}`;
}

export function matchRequest(type: TitleType, id: number, tmdbId: number): { path: string; body: Record<string, unknown> } {
  return { path: '/api/admin/match', body: { type, id, tmdbId } };
}

export function refreshPath(type: TitleType, id: number): string {
  return `/api/admin/refresh/${type}/${id}`;
}

/** What to say after refreshing: found on TMDB, or nothing that matched. */
export function refreshNotice(result: string): MessageKey {
  return result === 'matched' ? 'adminItem.refreshed' : 'adminItem.noMatch';
}

/**
 * A movie matched to another TMDB entry can be merged into a movie already in the library, so it
 * gets another id: then the page opens that one. A show keeps its id.
 */
export function matchedRoute(type: TitleType, oldId: number, newId: number): string | null {
  if (newId === oldId) return null;
  return type === 'movie' ? `/movie/${newId}` : `/show/${newId}`;
}

/** The collections an administrator made that the title is in (a movie series is not chosen by hand). */
export function manualIds(collections: CollectionRef[] | undefined): number[] {
  return (collections ?? []).filter((c) => c.kind === 'manual').map((c) => c.id);
}

export function collectionRequest(type: TitleType, id: number, collectionId: number, add: boolean): ApiRequest {
  if (add) return { method: 'POST', path: `/api/collections/${collectionId}/items`, body: type === 'movie' ? { movieId: id } : { showId: id } };
  return { method: 'DELETE', path: `/api/collections/${collectionId}/items/${type}/${id}` };
}

/** A line under a candidate: year, original title when it differs, and how sure the match is. */
export function candidateLine(c: Pick<MatchCandidate, 'title' | 'originalTitle' | 'year' | 'confidence'>): string {
  const parts: string[] = [];
  if (c.year) parts.push(String(c.year));
  if (c.originalTitle && c.originalTitle !== c.title) parts.push(c.originalTitle);
  parts.push(`${Math.round(Math.max(0, Math.min(1, c.confidence)) * 100)}%`);
  return parts.join(' · ');
}
