import { t } from '../i18n';
import { episodeCode, formatRuntime } from './format';
import type { SearchResults } from './types';

export type QuickGroup = 'movies' | 'shows' | 'episodes';

export interface QuickItem {
  key: string;
  group: QuickGroup;
  href: string;
  title: string;
  meta: string | null;
  image: string | null;
  wide: boolean;
}

/** Group headings, in the current language. */
export const groupLabel = (g: QuickGroup): string => t(`search.groups.${g}`);

/** "reacher s02e04", "2x04", "season 2": the person is looking for an episode. */
export function looksLikeEpisodeCode(query: string): boolean {
  return /\bs\d{1,3}\s*[ .-]?\s*e\d|\b\d{1,2}x\d|\bseason\s*\d|\bs\d{1,3}\b/i.test(query);
}

/**
 * Search results as one list for keyboard navigation: a few of each kind, movies, then shows,
 * then episodes — or episodes first when an episode code was typed.
 */
export function quickItems(r: SearchResults | undefined, limits: Record<QuickGroup, number> = { movies: 5, shows: 5, episodes: 6 }): QuickItem[] {
  if (!r) return [];
  const items = [
    ...r.movies.slice(0, limits.movies).map((m) => ({
      key: `movie-${m.id}`,
      group: 'movies' as const,
      href: `/movies/${m.id}`,
      title: m.title,
      meta: [m.year, formatRuntime(m.runtime)].filter(Boolean).join(' · ') || null,
      image: m.posterPath,
      wide: false,
    })),
    ...r.shows.slice(0, limits.shows).map((s) => ({
      key: `show-${s.id}`,
      group: 'shows' as const,
      href: `/shows/${s.id}`,
      title: s.title,
      meta: [s.year, s.seasonCount ? t('series.seasonCount', { count: s.seasonCount }) : null].filter(Boolean).join(' · ') || null,
      image: s.posterPath,
      wide: false,
    })),
    ...r.episodes.slice(0, limits.episodes).map((e) => ({
      key: `episode-${e.id}`,
      group: 'episodes' as const,
      href: `/play/episode/${e.id}`,
      title: `${e.showTitle} ${episodeCode(e.seasonNumber, e.episodeNumber)}`,
      meta: e.title,
      image: e.stillPath,
      wide: true,
    })),
  ];
  return looksLikeEpisodeCode(r.query) ? [...items.filter((i) => i.group === 'episodes'), ...items.filter((i) => i.group !== 'episodes')] : items;
}

export function totalResults(r: SearchResults | undefined): number {
  return r ? r.movies.length + r.shows.length + r.episodes.length : 0;
}
