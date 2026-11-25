import type { CollectionSummary, SmartCollection } from './collections';
import type { MessageKey } from './i18n';

/**
 * Admin → Collections on the phone, as on the website: manual collections (name, description, titles
 * added by hand) and smart collections (a saved filter of the Movies or TV Shows list). Movie series
 * (auto) and the built-in smart collections are made by the server and cannot be changed.
 */

export type SmartKind = 'movies' | 'shows';

/** The filters a smart collection can hold (the server's FILTER_KEYS). */
export interface SmartDraft {
  kind: SmartKind;
  filter: string;
  genre: string;
  resolution: string;
  hdr: boolean;
  yearFrom: string;
  yearTo: string;
  minRating: string;
  maxRuntime: string;
  sort: string;
}

export const EMPTY_SMART: SmartDraft = { kind: 'movies', filter: 'all', genre: '', resolution: '', hdr: false, yearFrom: '', yearTo: '', minRating: '', maxRuntime: '', sort: 'title' };

export const SORTS = ['title', 'added', 'watched', 'release', 'year', 'rating', 'runtime'] as const;
export const RESOLUTIONS = ['4k', '1080p', '720p', 'sd'] as const;
export function sortKey(sort: string): MessageKey {
  return `adminCollections.sortBy.${sort}` as MessageKey;
}
export const RATINGS = ['5', '6', '7', '8'] as const;

/** Watch states for the "Show" filter; for shows "watched" is called "completed" (as on the website). */
export function watchFilters(kind: SmartKind): { value: string; key: MessageKey }[] {
  return [
    { value: 'all', key: 'adminCollections.filter.all' },
    { value: 'unwatched', key: 'adminCollections.filter.unwatched' },
    { value: 'in-progress', key: 'adminCollections.filter.inProgress' },
    { value: kind === 'movies' ? 'watched' : 'completed', key: kind === 'movies' ? 'adminCollections.filter.watched' : 'adminCollections.filter.completed' },
    { value: 'favorites', key: 'adminCollections.filter.favorites' },
    { value: 'watchlist', key: 'adminCollections.filter.watchlist' },
  ];
}

/** Switching between movies and shows keeps what still applies (quality and runtime are for movies only). */
export function withKind(d: SmartDraft, kind: SmartKind): SmartDraft {
  if (d.kind === kind) return d;
  const filter = d.filter === 'watched' || d.filter === 'completed' ? (kind === 'movies' ? 'watched' : 'completed') : d.filter;
  const movieOnly = kind === 'shows' ? { resolution: '', hdr: false, maxRuntime: '' } : {};
  // Genres differ between movies and shows, and "runtime" sorts movies only.
  return { ...d, ...movieOnly, kind, filter, genre: '', sort: kind === 'shows' && d.sort === 'runtime' ? 'title' : d.sort };
}

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** What is wrong with the filter, or null when the server will take it. */
export function smartProblem(name: string, d: SmartDraft): MessageKey | null {
  if (!name.trim()) return 'adminCollections.nameNeeded';
  for (const y of [d.yearFrom, d.yearTo]) {
    if (y.trim() && !(int(y) >= 1870 && int(y) <= 2100)) return 'adminCollections.badYear';
  }
  if (d.yearFrom.trim() && d.yearTo.trim() && int(d.yearFrom) > int(d.yearTo)) return 'adminCollections.badYear';
  if (d.kind === 'movies' && d.maxRuntime.trim() && !(int(d.maxRuntime) >= 1 && int(d.maxRuntime) <= 1000)) return 'adminCollections.badRuntime';
  return null;
}

/** The filters as the server stores them: only what is set. */
export function smartQuery(d: SmartDraft): Record<string, string> {
  const q: Record<string, string> = {};
  if (d.sort && d.sort !== 'title') q.sort = d.sort;
  if (d.filter && d.filter !== 'all') q.filter = d.filter;
  if (d.genre) q.genre = d.genre;
  if (d.kind === 'movies') {
    if (d.resolution) q.resolution = d.resolution;
    if (d.hdr) q.hdr = '1';
    if (d.maxRuntime.trim()) q.maxRuntime = String(int(d.maxRuntime));
  }
  if (d.yearFrom.trim()) q.yearFrom = String(int(d.yearFrom));
  if (d.yearTo.trim()) q.yearTo = String(int(d.yearTo));
  if (d.minRating) q.minRating = d.minRating;
  return q;
}

/** POST /api/collections/smart. */
export function smartBody(name: string, d: SmartDraft): { name: string; kind: SmartKind; query: Record<string, string> } {
  return { name: name.trim(), kind: d.kind, query: smartQuery(d) };
}

/** POST /api/collections and PUT /api/collections/:id: an empty description is none. */
export function collectionBody(name: string, overview: string): { name: string; overview: string | null } {
  return { name: name.trim(), overview: overview.trim() || null };
}

/** A smart collection's filters in words, for its card and edit screen (`genreName` finds a genre's name). */
export function filterLines(c: Pick<SmartCollection, 'kind' | 'query'>, genreName?: (id: string) => string | undefined): { key: MessageKey; params?: Record<string, string> }[] {
  const q = c.query;
  const out: { key: MessageKey; params?: Record<string, string> }[] = [];
  const watch = watchFilters(c.kind).find((f) => f.value === q.filter && f.value !== 'all');
  if (watch) out.push({ key: watch.key });
  if (q.genre) out.push({ key: 'adminCollections.line.genre', params: { name: genreName?.(q.genre) ?? `#${q.genre}` } });
  if (q.resolution) out.push({ key: 'adminCollections.line.quality', params: { value: q.resolution === 'sd' ? 'SD' : q.resolution.toUpperCase().replace('P', 'p') } });
  if (q.hdr) out.push({ key: 'adminCollections.line.hdr' });
  if (q.yearFrom && q.yearTo) out.push({ key: 'adminCollections.line.years', params: { from: q.yearFrom, to: q.yearTo } });
  else if (q.yearFrom) out.push({ key: 'adminCollections.line.fromYear', params: { year: q.yearFrom } });
  else if (q.yearTo) out.push({ key: 'adminCollections.line.untilYear', params: { year: q.yearTo } });
  if (q.minRating) out.push({ key: 'adminCollections.line.rating', params: { rating: q.minRating } });
  if (q.maxRuntime) out.push({ key: 'adminCollections.line.runtime', params: { n: q.maxRuntime } });
  if (q.sort && q.sort !== 'title' && (SORTS as readonly string[]).includes(q.sort)) out.push({ key: sortKey(q.sort) });
  return out;
}

/** The screen that edits a collection: manual by id, smart with `smart=1` (none: new). */
export function editHref(c: { id: number; smart?: boolean } | null, smart = false): string {
  if (!c) return smart ? '/admin/collection?smart=1' : '/admin/collection';
  return c.smart ? `/admin/collection?id=${c.id}&smart=1` : `/admin/collection?id=${c.id}`;
}

/** The id from the screen's parameters; null for a new collection. */
export function paramId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN;
  return n > 0 ? n : null;
}

/** What the admin list shows: the ones that can be changed first, then the movie series (read only). */
export function adminLists(collections: CollectionSummary[], smart: SmartCollection[]) {
  return {
    manual: collections.filter((c) => c.kind === 'manual'),
    smart: smart.filter((c) => c.custom && c.id !== null),
    auto: collections.filter((c) => c.kind === 'auto'),
  };
}

/** A title to add or remove (POST /api/collections/:id/items, DELETE …/items/:type/:id). */
export interface TitleRef {
  type: 'movie' | 'show';
  id: number;
}

export function addItemBody(t: TitleRef): { movieId: number } | { showId: number } {
  return t.type === 'movie' ? { movieId: t.id } : { showId: t.id };
}

export function removeItemPath(collectionId: number, t: TitleRef): string {
  return `/api/collections/${collectionId}/items/${t.type}/${t.id}`;
}

export function inCollection(items: TitleRef[], t: TitleRef): boolean {
  return items.some((i) => i.type === t.type && i.id === t.id);
}

/** Search the library for titles to add (GET /api/search); shorter than 2 letters searches nothing. */
export function searchPath(text: string): string | null {
  const q = text.trim();
  return q.length >= 2 ? `/api/search?q=${encodeURIComponent(q.slice(0, 100))}` : null;
}

/** The query keys of the viewer screens (lists, one collection, title pages, browse) under a server. */
export function collectionKeys(serverUrl: string | null): unknown[][] {
  return [[serverUrl, 'collections'], [serverUrl, 'collection'], [serverUrl, 'movie'], [serverUrl, 'show']];
}
