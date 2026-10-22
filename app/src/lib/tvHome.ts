import { formatRuntime } from './format';
import type { Translate } from './i18n';
import type { SeerrResult } from './discover';
import type { Card, ContinueItem, HomeData } from './types';

type T = Translate;

/** What one tile of a row on the TV home screen shows: a poster, and wide artwork when chosen. */
export interface TvTile {
  key: string;
  title: string;
  poster: string | null;
  /** Wide artwork for the chosen tile (falls back to the poster). */
  wide: string | null;
  /** "Show · Drama · 2016 · 8 seasons" under the row while the tile is chosen. */
  meta: string[];
  overview: string;
  /** 0–1, a line under the artwork. */
  progress: number;
  /** A small label on the artwork ("Requested", "Up next"). */
  badge: string | null;
}

/** The facts under a chosen title: kind, first genre, year, and length or number of seasons. */
export function cardMeta(card: Card, t: T): string[] {
  const kind = card.type === 'movie' ? t('request.movie') : t('request.show');
  const length = card.type === 'movie' ? formatRuntime(card.runtime) : card.seasonCount ? (card.seasonCount === 1 ? t('show.season') : t('show.seasons', { n: card.seasonCount })) : null;
  return [kind, card.genres?.[0] ?? null, card.year ? String(card.year) : null, length].filter((x): x is string => Boolean(x));
}

export function cardTile(card: Card, t: T): TvTile {
  const progress = card.type === 'movie' && card.progress && card.progress.durationSec > 0 && !card.progress.completed ? Math.min(1, card.progress.positionSec / card.progress.durationSec) : 0;
  return { key: `${card.type}-${card.id}`, title: card.title, poster: card.posterPath, wide: card.backdropPath, meta: cardMeta(card, t), overview: card.overview ?? '', progress, badge: null };
}

export function continueTile(item: ContinueItem, t: T): TvTile {
  const kind = item.type === 'movie' ? t('request.movie') : t('request.show');
  return {
    key: `${item.type}-${item.id}`,
    title: item.title,
    poster: item.posterPath,
    wide: item.imagePath,
    meta: [kind, item.subtitle].filter((x): x is string => Boolean(x)),
    overview: item.episodeTitle ?? '',
    progress: item.percent / 100,
    badge: item.upNext ? t('home.upNext') : null,
  };
}

export function discoverTile(item: SeerrResult, t: T): TvTile {
  const kind = item.mediaType === 'movie' ? t('request.movie') : t('request.show');
  return {
    key: `${item.mediaType}-${item.tmdbId}`,
    title: item.title,
    poster: item.posterPath,
    wide: item.backdropPath ?? null,
    meta: [kind, item.year ? String(item.year) : null].filter((x): x is string => Boolean(x)),
    overview: item.overview,
    progress: 0,
    badge: item.inLibrary ? t('discover.inLibrary') : item.state ? t(`request.state.${item.state}`) : null,
  };
}

/** The big title at the top: where the viewer left off, else the newest title with artwork (as on the website). */
export function heroPick(d: HomeData): { kind: 'continue'; item: ContinueItem } | { kind: 'card'; card: Card } | null {
  const cw = d.hero ?? d.continueWatching[0];
  if (cw) return { kind: 'continue', item: cw };
  const card = d.recentlyAdded.find((c) => c.backdropPath) ?? d.recentlyAdded[0];
  return card ? { kind: 'card', card } : null;
}

export type GenreTile = { id: number; name: string; kind: 'movies' | 'shows' };

/**
 * The genre tiles under the big title: the genres of movies and shows together, one tile per
 * name (on the side with the most titles), the biggest first.
 */
export function genreTiles(movies: Array<{ id: number; name: string; count: number }>, shows: Array<{ id: number; name: string; count: number }>, max = 12): GenreTile[] {
  const best = new Map<string, GenreTile & { count: number }>();
  for (const [kind, list] of [['movies', movies], ['shows', shows]] as const) {
    for (const g of list) {
      if (g.count <= 0) continue;
      const name = g.name.trim().toLowerCase();
      const had = best.get(name);
      if (!had || g.count > had.count) best.set(name, { id: g.id, name: g.name, kind, count: g.count });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(({ id, name, kind }) => ({ id, name, kind }));
}

/**
 * Where a row scrolls to when a tile is chosen: the chosen tile at the left edge. Every tile
 * before it is a poster, so the offset is that many posters with their gaps.
 */
export function rowOffset(index: number, posterWidth: number, gap: number): number {
  return Math.max(0, index) * (posterWidth + gap);
}

/** Sizes on a TV screen of `height` points: posters and the chosen (wide) tile share one height. */
export function tvSizes(width: number, height: number) {
  const tile = Math.round(Math.min(height * 0.34, width * 0.2));
  return { tile, poster: Math.round(tile / 1.5), wide: Math.round((tile * 16) / 9), gap: 14, side: Math.round(width * 0.05) };
}
