import { describe, expect, it } from 'vitest';
import { browsePath, filterQuery, smartHref, smartNameKey } from './collections';
import { historyTarget } from './history';

describe('collections', () => {
  it('names the built-in smart collections in the app language and keeps a custom name', () => {
    expect(smartNameKey({ key: 'top-rated', custom: false })).toBe('collections.builtIn.top-rated');
    expect(smartNameKey({ key: 'top-rated', custom: true })).toBeNull();
    expect(smartNameKey({ key: 'custom-3', custom: false })).toBeNull();
  });

  it('opens a smart collection with its filters and takes them back without the screen parameters', () => {
    const href = smartHref({ kind: 'movies', query: { minRating: '8', sort: 'rating' } }, 'Top rated');
    expect(href).toBe('/browse?minRating=8&sort=rating&kind=movies&title=Top+rated');
    const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(filterQuery(params)).toEqual({ minRating: '8', sort: 'rating' });
    expect(filterQuery({ kind: 'shows', title: 'x', page: '3', filter: ['in-progress'], empty: '' })).toEqual({ filter: 'in-progress' });
  });

  it('asks the server for one page of the filtered movies or shows', () => {
    expect(browsePath('shows', { filter: 'in-progress' }, 2, 60)).toBe('/api/shows?filter=in-progress&page=2&limit=60');
  });

  it('opens a viewing in the history at its movie or show, and nothing when that is gone', () => {
    expect(historyTarget({ kind: 'movie', movieId: 4, showId: null })).toBe('/movie/4');
    expect(historyTarget({ kind: 'episode', movieId: null, showId: 9 })).toBe('/show/9');
    expect(historyTarget({ kind: 'episode', movieId: null, showId: null })).toBeNull();
  });
});
