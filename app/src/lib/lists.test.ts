import { describe, expect, it } from 'vitest';
import { savedRequest, searchQuery, watchedRequest } from './lists';

describe('watchlist and favorites', () => {
  it('adds with the right id field', () => {
    expect(savedRequest('watchlist', 'movie', 7, true)).toEqual({ method: 'POST', path: '/api/watchlist', body: { movieId: 7 } });
    expect(savedRequest('favorites', 'show', 3, true)).toEqual({ method: 'POST', path: '/api/favorites', body: { showId: 3 } });
  });
  it('removes by type and id', () => {
    expect(savedRequest('watchlist', 'show', 3, false)).toEqual({ method: 'DELETE', path: '/api/watchlist/show/3' });
    expect(savedRequest('favorites', 'movie', 7, false)).toEqual({ method: 'DELETE', path: '/api/favorites/movie/7' });
  });
});

describe('watched', () => {
  it('marks movies, episodes, seasons and shows', () => {
    expect(watchedRequest({ movieId: 1 }, true)).toEqual({ method: 'POST', path: '/api/progress/watched', body: { movieId: 1, watched: true } });
    expect(watchedRequest({ episodeId: 2 }, false).body).toEqual({ episodeId: 2, watched: false });
    expect(watchedRequest({ seasonId: 3 }, true).body).toEqual({ seasonId: 3, watched: true });
    expect(watchedRequest({ showId: 4 }, false).body).toEqual({ showId: 4, watched: false });
  });
});

describe('searchQuery', () => {
  it('needs two characters', () => {
    expect(searchQuery('')).toBeNull();
    expect(searchQuery(' a ')).toBeNull();
    expect(searchQuery('s2')).toBe('s2');
  });
  it('tidies spaces and length', () => {
    expect(searchQuery('  the   office ')).toBe('the office');
    expect(searchQuery('x'.repeat(150))).toHaveLength(100);
  });
});
