import { formatRuntime } from './format';
import type { RequestState, SeerrResult } from './discover';
import type { Translate } from './i18n';
import type { Card, ContinueItem, HomeData } from './types';

/** What one poster on the TV home screen shows, with the details that appear over it when chosen (as on the website). */
export interface TvTile {
  key: string;
  title: string;
  poster: string | null;
  /** The line under the poster: the year, or the kind of title. */
  sub: string;
  /** "2008 • 2h 32m" or "2008 • 5 seasons". */
  facts: string;
  rating: number | null;
  /** "Drama • Action". */
  genres: string;
  /** 0–1, a line on the poster. */
  progress: number;
  /** On this server: a green check on the poster (catalog titles; the library's own need none). */
  here: boolean;
  /** Where its request stands, as a label on the poster (catalog titles not here). */
  state: RequestState | null;
}

/** "2008 • 2h 32m" for a movie, "2008 • 5 seasons" for a show (the website's card details). */
export function cardFacts(card: Card, t: Translate): string {
  const second = card.type === 'movie' ? formatRuntime(card.runtime) : card.seasonCount ? (card.seasonCount === 1 ? t('show.season') : t('show.seasons', { n: card.seasonCount })) : null;
  return [card.year ? String(card.year) : null, second].filter(Boolean).join(' • ');
}

export function cardTile(card: Card, t: Translate): TvTile {
  const progress = card.type === 'movie' && card.progress && card.progress.durationSec > 0 && !card.progress.completed ? Math.min(1, card.progress.positionSec / card.progress.durationSec) : 0;
  return {
    key: `${card.type}-${card.id}`,
    title: card.title,
    poster: card.posterPath,
    sub: card.year ? String(card.year) : '',
    facts: cardFacts(card, t),
    rating: card.rating,
    genres: (card.genres ?? []).join(' • '),
    progress,
    here: false,
    state: null,
  };
}

export function discoverTile(item: SeerrResult, t: Translate): TvTile {
  const kind = item.mediaType === 'movie' ? t('request.movie') : t('request.show');
  return {
    key: `${item.mediaType}-${item.tmdbId}`,
    title: item.title,
    poster: item.posterPath,
    sub: [kind, item.year].filter(Boolean).join(' · '),
    facts: item.year ? String(item.year) : '',
    rating: null,
    genres: '',
    progress: 0,
    here: item.inLibrary,
    state: item.inLibrary ? null : item.state,
  };
}

/** The big title at the top: where the viewer left off, else the newest title with artwork (as on the website). */
export function heroPick(d: HomeData): { kind: 'continue'; item: ContinueItem } | { kind: 'card'; card: Card } | null {
  const cw = d.hero ?? d.continueWatching[0];
  if (cw) return { kind: 'continue', item: cw };
  const card = d.recentlyAdded.find((c) => c.backdropPath) ?? d.recentlyAdded[0];
  return card ? { kind: 'card', card } : null;
}

/** Poster width on a TV screen of `height` points (the rows of the home screen). */
export function tvPosterWidth(height: number): number {
  return Math.round(Math.min(150, Math.max(110, height * 0.24)));
}

/**
 * Where the home screen scrolls to for the row with the focus: that row in the middle of what is
 * visible, so it is never half in view (never above the top). `atLeast` keeps the hero out of view
 * once a row has the focus: its buttons showed half under the top bar.
 */
export function rowScroll(top: number, height: number, visible: number, atLeast = 0): number {
  const middle = visible > 0 ? Math.round(top - Math.max(0, visible - height) / 2) : top;
  return Math.max(0, atLeast, middle);
}

/**
 * Whether the TV's top bar lies see-through over Home's hero (true) or on the background colour
 * (false, once a row below the hero has the focus). Home sets it, the top bar follows it.
 */
export function overHeroStore() {
  let over = true;
  const listeners = new Set<() => void>();
  return {
    get: () => over,
    set(next: boolean) {
      if (next === over) return;
      over = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const overHero = overHeroStore();
