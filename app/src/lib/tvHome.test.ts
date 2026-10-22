import { describe, expect, it } from 'vitest';
import { translator } from './i18n';
import { cardFacts, cardTile, discoverTile, heroPick, tvPosterWidth } from './tvHome';
import type { ContinueItem, HomeData, MovieCard, ShowCard } from './types';

const t = translator('nl');
const movie: MovieCard = { type: 'movie', id: 1, title: 'Film', year: 2024, posterPath: '/p.jpg', backdropPath: '/b.jpg', rating: 7.25, runtime: 125, overview: 'Over de film', genres: ['Drama', 'Actie'], progress: { positionSec: 600, durationSec: 6000, completed: false } };
const show: ShowCard = { type: 'show', id: 2, title: 'Serie', year: 2016, posterPath: '/s.jpg', backdropPath: null, rating: null, genres: ['Comedy'], seasonCount: 8, episodeCount: 80, watchedCount: 0 };
const cw: ContinueItem = { type: 'episode', id: 9, title: 'Serie', subtitle: 'S01E02', imagePath: '/still.jpg', posterPath: '/s.jpg', showId: 2, seasonNumber: 1, episodeNumber: 2, episodeTitle: 'Twee', upNext: true, progress: null, percent: 40 };
const home = (over: Partial<HomeData>): HomeData => ({ continueWatching: [], recentlyAdded: [], watchlist: [], favorites: [], movies: [], shows: [], counts: { movies: 0, shows: 0, libraries: 0 }, ...over });

describe('tv home', () => {
  it('shows the facts of a poster as on the website: year and length or seasons', () => {
    expect(cardFacts(movie, t)).toBe('2024 • 2h 5m');
    expect(cardFacts(show, t)).toBe('2016 • 8 seizoenen');
    expect(cardFacts({ ...show, seasonCount: 1, year: null }, t)).toBe('1 seizoen');
  });

  it('makes posters with details, genres and progress', () => {
    expect(cardTile(movie, t)).toMatchObject({ key: 'movie-1', sub: '2024', rating: 7.25, genres: 'Drama • Actie', progress: 0.1 });
    expect(cardTile({ ...movie, progress: { positionSec: 6000, durationSec: 6000, completed: true } }, t).progress).toBe(0);
    expect(cardTile({ ...show, genres: undefined }, t).genres).toBe('');
    expect(discoverTile({ mediaType: 'tv', tmdbId: 5, title: 'X', year: 2020, overview: 'o', posterPath: null, state: 'requested', inLibrary: false, local: null }, t)).toMatchObject({ key: 'tv-5', sub: 'Serie · 2020', badge: t('request.state.requested') });
    expect(discoverTile({ mediaType: 'movie', tmdbId: 6, title: 'Y', year: null, overview: '', posterPath: null, state: null, inLibrary: true, local: null }, t).badge).toBe(t('discover.inLibrary'));
  });

  it('picks where the viewer left off for the hero, else the newest title with artwork', () => {
    expect(heroPick(home({ hero: cw }))).toEqual({ kind: 'continue', item: cw });
    expect(heroPick(home({ continueWatching: [cw] }))).toEqual({ kind: 'continue', item: cw });
    expect(heroPick(home({ recentlyAdded: [show, movie] }))).toEqual({ kind: 'card', card: movie });
    expect(heroPick(home({ recentlyAdded: [show] }))).toEqual({ kind: 'card', card: show });
    expect(heroPick(home({}))).toBeNull();
  });

  it('keeps posters readable on small and large TV screens', () => {
    expect(tvPosterWidth(540)).toBe(130);
    expect(tvPosterWidth(300)).toBe(110);
    expect(tvPosterWidth(1080)).toBe(150);
  });
});
