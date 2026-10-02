import { describe, expect, it } from 'vitest';
import { trailerPath, trailerUrl } from './trailer';

describe('trailerUrl', () => {
  it('opens the trailer on YouTube, and nothing for an odd video id', () => {
    expect(trailerUrl({ key: 'vKQi3bBA1y8', name: 'Trailer' })).toBe('https://www.youtube.com/watch?v=vKQi3bBA1y8');
    expect(trailerUrl({ key: 'x&list=evil', name: '' })).toBeNull();
    expect(trailerUrl({ key: '', name: '' })).toBeNull();
  });
});

describe('trailerPath', () => {
  it('asks for a library item by its id, and any other title by its TMDB id', () => {
    expect(trailerPath('movie', 5)).toBe('/api/movies/5/trailer');
    expect(trailerPath('show', 7)).toBe('/api/shows/7/trailer');
    expect(trailerPath('movie', 604, true)).toBe('/api/seerr/movie/604/trailer');
    expect(trailerPath('show', 1399, true)).toBe('/api/seerr/tv/1399/trailer');
  });
});
