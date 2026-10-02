import { describe, expect, it } from 'vitest';
import { looksLikeEpisodeCode, quickItems, totalResults } from './search';
import type { SearchResults } from './types';

const movie = (id: number, title: string) => ({ type: 'movie', id, title, year: 2021, posterPath: null, runtime: 155 }) as unknown as SearchResults['movies'][number];
const show = (id: number, title: string) => ({ type: 'show', id, title, year: 2022, posterPath: null, seasonCount: 2, episodeCount: 16 }) as unknown as SearchResults['shows'][number];
const r: SearchResults = {
  query: 're',
  movies: [movie(1, 'Dune'), movie(2, 'Interstellar')],
  shows: [show(3, 'Reacher'), show(4, 'Narcos')],
  episodes: [{ id: 9, showId: 3, showTitle: 'Reacher', seasonNumber: 2, episodeNumber: 4, title: 'A Night at the Motel', stillPath: null, progress: null }],
};

describe('quick search items', () => {
  it('lists movies, then shows, then episodes, with where each one leads', () => {
    expect(quickItems(r).map((i) => [i.group, i.title, i.meta, i.href])).toEqual([
      ['movies', 'Dune', '2021 · 2h 35m', '/movies/1'],
      ['movies', 'Interstellar', '2021 · 2h 35m', '/movies/2'],
      ['shows', 'Reacher', '2022 · 2 seasons', '/shows/3'],
      ['shows', 'Narcos', '2022 · 2 seasons', '/shows/4'],
      ['episodes', 'Reacher S02E04', 'A Night at the Motel', '/play/episode/9'],
    ]);
  });

  it('keeps only a few of each kind', () => {
    expect(quickItems(r, [], { movies: 1, shows: 0, episodes: 1, catalog: 0 }).map((i) => i.title)).toEqual(['Dune', 'Reacher S02E04']);
    expect(quickItems(undefined)).toEqual([]);
    expect(totalResults(r)).toBe(5);
  });
});

describe('titles that are not in the library', () => {
  const outside = (tmdbId: number, title: string, mediaType: 'movie' | 'tv') => ({ mediaType, tmdbId, title, year: 2024, overview: '', posterPath: '/p.jpg', state: null, inLibrary: false, local: null });

  it('come after the library, and open their page to be requested', () => {
    const items = quickItems(r, [outside(5, 'Reacher Returns', 'movie'), outside(6, 'Reach', 'tv')]);
    expect(items.slice(-2).map((i) => [i.group, i.title, i.meta, i.href])).toEqual([
      ['catalog', 'Reacher Returns', '2024 · Movie', '/request/movie/5'],
      ['catalog', 'Reach', '2024 · Show', '/request/tv/6'],
    ]);
    expect(totalResults(r, [outside(5, 'Reacher Returns', 'movie')])).toBe(6);
    // Nothing in the library: only these.
    expect(quickItems(undefined, [outside(5, 'Reacher Returns', 'movie')]).map((i) => i.href)).toEqual(['/request/movie/5']);
  });
});

describe('episode codes', () => {
  it('recognises codes and puts episodes first for them', () => {
    for (const q of ['reacher s02e04', 's2e4', 'reacher 2x04', 'season 2 episode 4', 'reacher s02']) expect(looksLikeEpisodeCode(q)).toBe(true);
    for (const q of ['reacher', '1917', 'se7en', 'x-men']) expect(looksLikeEpisodeCode(q)).toBe(false);
    expect(quickItems({ ...r, query: 'reacher s02e04' })[0].title).toBe('Reacher S02E04');
    expect(quickItems(r)[0].title).toBe('Dune');
  });
});
