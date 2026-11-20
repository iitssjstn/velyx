import type { MessageKey } from './i18n';

/** A collection of the library (GET /api/collections): a movie series, or one an administrator made. */
export interface CollectionSummary {
  id: number;
  name: string;
  kind: 'auto' | 'manual';
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  itemCount: number;
}

/** A saved filter (GET /api/collections/smart): it opens the movies or shows that match it. */
export interface SmartCollection {
  key: string;
  id: number | null;
  name: string;
  kind: 'movies' | 'shows';
  query: Record<string, string>;
  custom: boolean;
  count: number;
  posterPath: string | null;
}

const BUILT_IN = ['recently-added', 'unwatched', 'top-rated', '4k', '1080p', 'hdr', 'short', 'favorites', 'shows-in-progress', 'shows-unwatched'] as const;

/** Built-in smart collections have a name in every language; custom ones keep the name they were given. */
export function smartNameKey(c: Pick<SmartCollection, 'key' | 'custom'>): MessageKey | null {
  return !c.custom && (BUILT_IN as readonly string[]).includes(c.key) ? (`collections.builtIn.${c.key}` as MessageKey) : null;
}

/** The screen that lists what a smart collection holds: its kind, name and filters as parameters. */
export function smartHref(c: Pick<SmartCollection, 'kind' | 'query'>, title: string): string {
  const qs = new URLSearchParams({ ...c.query, kind: c.kind, title });
  return `/browse?${qs.toString()}`;
}

/** The parameters of a filter, taken back from the screen's parameters (kind and title are not filters). */
export function filterQuery(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'kind' || k === 'title' || k === 'page' || k === 'limit') continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== '') out[k] = value;
  }
  return out;
}

/** One page of a filtered list of movies or shows (the same request as the website's Movies page). */
export function browsePath(kind: 'movies' | 'shows', query: Record<string, string>, page: number, limit: number): string {
  const qs = new URLSearchParams({ ...query, page: String(page), limit: String(limit) });
  return `/api/${kind}?${qs.toString()}`;
}
