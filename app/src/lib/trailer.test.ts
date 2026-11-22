import { describe, expect, it } from 'vitest';
import { TRAILER_ORIGIN, trailerEvent, trailerHtml, trailerPath, trailerUrl } from './trailer';

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

describe('the trailer window', () => {
  it('plays the video in YouTube\'s embedded player, from the website\'s address, and nothing for an odd id', () => {
    const html = trailerHtml({ key: 'vKQi3bBA1y8', name: 'Trailer' })!;
    expect(html).toContain('videoId:"vKQi3bBA1y8"');
    expect(html).toContain("host:'https://www.youtube-nocookie.com'");
    expect(html).toContain(`"origin":"${TRAILER_ORIGIN}"`);
    expect(html).toContain('"autoplay":1');
    expect(trailerHtml({ key: '"></script><script>alert(1)', name: '' })).toBeNull();
  });

  it('closes when the trailer ends and falls back to YouTube when it cannot be embedded', () => {
    expect(trailerEvent('ended')).toBe('ended');
    expect(trailerEvent('error:150')).toBe('failed');
    expect(trailerEvent('error:load')).toBe('failed');
    expect(trailerEvent('something')).toBeNull();
  });
});
