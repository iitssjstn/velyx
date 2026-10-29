import { describe, expect, it, vi } from 'vitest';
import { translator } from './i18n';
import { cardFacts, cardTile, discoverTile, heroPick, overHeroStore, returnGate, RETURN_SETTLE_MS, rowScroll, tvPosterWidth } from './tvHome';
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
    expect(discoverTile({ mediaType: 'tv', tmdbId: 5, title: 'X', year: 2020, overview: 'o', posterPath: null, state: 'requested', inLibrary: false, local: null }, t)).toMatchObject({ key: 'tv-5', sub: 'Serie · 2020', here: false, state: 'requested' });
    expect(discoverTile({ mediaType: 'movie', tmdbId: 6, title: 'Y', year: null, overview: '', posterPath: null, state: 'available', inLibrary: true, local: null }, t)).toMatchObject({ here: true, state: null });
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

  it('puts the row with the focus in the middle of the screen', () => {
    // A row of 280 high at 1000 on a screen with 480 visible: 100 above it and 100 under it.
    expect(rowScroll(1000, 280, 480)).toBe(900);
    // Near the top it never scrolls above the start.
    expect(rowScroll(50, 280, 480)).toBe(0);
    // Taller than the screen: its top at the top.
    expect(rowScroll(1000, 600, 480)).toBe(1000);
    expect(rowScroll(1000, 280, 0)).toBe(1000);
  });

  it('keeps the hero out of view once a row under it has the focus', () => {
    // First row at 730 under a hero ending there: centred it would scroll to 630, leaving the
    // hero's buttons under the top bar (60); now the hero ends at the bar.
    expect(rowScroll(730, 280, 480)).toBe(630);
    expect(rowScroll(730, 280, 480, 730 - 60)).toBe(670);
    // Further down the middle wins.
    expect(rowScroll(1500, 280, 480, 670)).toBe(1400);
  });

  it('tells the top bar whether it lies over the hero', () => {
    const store = overHeroStore();
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.get()).toBe(true);
    store.set(false);
    store.set(false);
    expect(store.get()).toBe(false);
    expect(calls).toBe(1);
  });

  it('does not follow the focus while another screen is on top, nor just after coming back', () => {
    vi.useFakeTimers();
    try {
      const gate = returnGate();
      const settle = vi.fn();
      // Shown for the first time: follows at once.
      gate.back(settle);
      expect(gate.follows()).toBe(true);
      // A title opened: Home stays where it is.
      gate.away();
      expect(gate.follows()).toBe(false);
      // Back: Android hands the focus to the hero first, then to the poster; neither moves Home.
      gate.back(settle);
      expect(gate.follows()).toBe(false);
      vi.advanceTimersByTime(RETURN_SETTLE_MS - 1);
      expect(settle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(settle).toHaveBeenCalledTimes(1);
      expect(gate.follows()).toBe(true);
      // Leaving again before it settled: no late jump.
      gate.away();
      gate.back(settle);
      gate.away();
      vi.advanceTimersByTime(RETURN_SETTLE_MS);
      expect(settle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

