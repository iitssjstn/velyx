import { describe, expect, it } from 'vitest';
import { trailerUrl } from './trailer';

describe('trailerUrl', () => {
  it('opens the trailer on YouTube, and nothing for an odd video id', () => {
    expect(trailerUrl({ key: 'vKQi3bBA1y8', name: 'Trailer' })).toBe('https://www.youtube.com/watch?v=vKQi3bBA1y8');
    expect(trailerUrl({ key: 'x&list=evil', name: '' })).toBeNull();
    expect(trailerUrl({ key: '', name: '' })).toBeNull();
  });
});
