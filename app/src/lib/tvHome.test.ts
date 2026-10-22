import { describe, expect, it } from 'vitest';
import { translator } from './i18n';
import { cardMeta, cardTile, continueTile, discoverTile, genreTiles, heroPick, rowOffset, tvSizes } from './tvHome';
import type { ContinueItem, HomeData, MovieCard, ShowCard } from './types';

const t = translator('nl');
const movie: MovieCard = { type: 'movie', id: 1, title: 'Film', year: 2024, posterPath: '/p.jpg', backdropPath: '/b.jpg', rating: 7, runtime: 125, overview: 'Over de film', genres: ['Drama', 'Actie'], progress: { positionSec: 600, durationSec: 6000, completed: false } };
const show: ShowCard = { type: 'show', id: 2, title: 'Serie', year: 2016, posterPath: '/s.jpg', backdropPath: null, rating: null, genres: ['Comedy'], seasonCount: 8, episodeCount: 80, watchedCount: 0 };
const cw: ContinueItem = { type: 'episode', id: 9, title: 'Serie', subtitle: 'S01E02', imagePath: '/still.jpg', posterPath: '/s.jpg', showId: 2, seasonNumber: 1, episodeNumber: 2, episodeTitle: 'Twee', upNext: true, progress: null, percent: 40 };
const home = (over: Partial<HomeData>): HomeData => ({ continueWatching: [], recentlyAdded: [], watchlist: [], favorites: [], movies: [], shows: [], counts: { movies: 0, shows: 0, libraries: 0 }, ...over });

describe('tv home', () => {
  it('lists the facts of a title: kind, genre, year and length or seasons', () => {
    expect(cardMeta(movie, t)).toEqual(['Film', 'Drama', '2024', '2h 5m']);
    expect(cardMeta(show, t)).toEqual(['Serie', 'Comedy', '2016', '8 seizoenen']);
    expect(cardMeta({ ...show, seasonCount: 1, genres: undefined, year: null }, t)).toEqual(['Serie', '1 seizoen']);
  });

  it('makes tiles with wide artwork, description and progress', () => {
    expect(cardTile(movie, t)).toMatchObject({ key: 'movie-1', wide: '/b.jpg', overview: 'Over de film', progress: 0.1 });
    expect(cardTile({ ...movie, progress: { positionSec: 6000, durationSec: 6000, completed: true } }, t).progress).toBe(0);
    expect(cardTile({ ...show, overview: undefined }, t).overview).toBe('');
    expect(continueTile(cw, t)).toMatchObject({ wide: '/still.jpg', meta: ['Serie', 'S01E02'], overview: 'Twee', progress: 0.4, badge: 'Hierna' });
    expect(discoverTile({ mediaType: 'tv', tmdbId: 5, title: 'X', year: 2020, overview: 'o', posterPath: null, backdropPath: '/w.jpg', state: 'requested', inLibrary: false, local: null }, t)).toMatchObject({ key: 'tv-5', wide: '/w.jpg', meta: ['Serie', '2020'], badge: t('request.state.requested') });
  });

  it('picks where the viewer left off for the big title, else the newest title with artwork', () => {
    expect(heroPick(home({ hero: cw }))).toEqual({ kind: 'continue', item: cw });
    expect(heroPick(home({ recentlyAdded: [show, movie] }))).toEqual({ kind: 'card', card: movie });
    expect(heroPick(home({ recentlyAdded: [show] }))).toEqual({ kind: 'card', card: show });
    expect(heroPick(home({}))).toBeNull();
  });

  it('shows one tile per genre name, on the side with the most titles, biggest first', () => {
    const tiles = genreTiles(
      [{ id: 18, name: 'Drama', count: 3 }, { id: 28, name: 'Actie', count: 9 }, { id: 99, name: 'Leeg', count: 0 }],
      [{ id: 18, name: 'drama', count: 20 }, { id: 35, name: 'Komedie', count: 2 }],
    );
    expect(tiles).toEqual([
      { id: 18, name: 'drama', kind: 'shows' },
      { id: 28, name: 'Actie', kind: 'movies' },
      { id: 35, name: 'Komedie', kind: 'shows' },
    ]);
    expect(genreTiles([{ id: 1, name: 'A', count: 1 }, { id: 2, name: 'B', count: 1 }], [], 1)).toHaveLength(1);
  });

  it('scrolls a row so the chosen tile is at the left edge', () => {
    expect(rowOffset(0, 120, 14)).toBe(0);
    expect(rowOffset(3, 120, 14)).toBe(402);
    expect(rowOffset(-1, 120, 14)).toBe(0);
  });

  it('sizes posters and the wide tile to the same height', () => {
    const s = tvSizes(960, 540);
    expect(s.poster).toBe(Math.round(s.tile / 1.5));
    expect(s.wide).toBe(Math.round((s.tile * 16) / 9));
    expect(s.tile).toBeLessThan(540 / 2);
  });
});
