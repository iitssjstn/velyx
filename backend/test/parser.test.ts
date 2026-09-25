import { describe, expect, it } from 'vitest';
import { isExtraFile, parseEpisodePath, parseMoviePath, parseReleaseName, parseSubtitleName, similarity, sortTitle } from '../src/services/parser.js';

describe('movie filename parsing', () => {
  it.each([
    ['Interstellar.2014.1080p.BluRay.x264.mkv', 'Interstellar', 2014],
    ['Spider-Man.Into.the.Spider-Verse.2018.WEB-DL.mp4', 'Spider-Man Into the Spider-Verse', 2018],
    ['2001 A Space Odyssey (1968).mkv', '2001 A Space Odyssey', 1968],
    ['1917 (2019)/1917.2019.2160p.mkv', '1917', 2019],
    ['1917.mkv', '1917', null],
    ['Blade Runner 2049 (2017)/Blade.Runner.2049.2017.mkv', 'Blade Runner 2049', 2017],
    ['Amelie [2001] [1080p].mkv', 'Amelie', 2001],
    ['Alien.1979.Directors.Cut.mkv', 'Alien', 1979],
    ['The Movie (2010)/movie.mkv', 'The Movie', 2010],
    ['Up.mp4', 'Up', null],
  ])('%s → %s (%s)', (input, title, year) => {
    const r = parseMoviePath(input);
    expect(r.title).toBe(title);
    expect(r.year).toBe(year);
  });

  it('reads TMDB id tags', () => {
    expect(parseMoviePath('The Matrix (1999) {tmdb-603}/The Matrix.mkv').tmdbId).toBe(603);
    expect(parseReleaseName('Heat (1995) [tmdbid-949]').tmdbId).toBe(949);
  });

  it('uses the folder year when the file has none', () => {
    expect(parseMoviePath('Heat (1995)/Heat.mkv')).toMatchObject({ title: 'Heat', year: 1995 });
  });

  it('detects extras and samples', () => {
    expect(isExtraFile('Movie (2010)/movie-sample.mkv')).toBe(true);
    expect(isExtraFile('Movie (2010)/Extras/interview.mkv')).toBe(true);
    expect(isExtraFile('Movie (2010)/Movie.mkv')).toBe(false);
  });
});

describe('episode parsing', () => {
  it('parses SxxEyy with show folder', () => {
    expect(parseEpisodePath('Breaking Bad/Season 01/S01E01.mkv')).toMatchObject({ showTitle: 'Breaking Bad', season: 1, episode: 1 });
  });
  it('parses release style names with titles', () => {
    expect(parseEpisodePath('Breaking Bad (2008)/Season 02/Breaking.Bad.S02E03.Bit.by.a.Dead.Bee.720p.mkv')).toMatchObject({
      showTitle: 'Breaking Bad',
      showYear: 2008,
      season: 2,
      episode: 3,
      episodeTitle: 'Bit by a Dead Bee',
    });
  });
  it('parses 1x02 style', () => {
    expect(parseEpisodePath('The Office/1x02 - Diversity Day.mkv')).toMatchObject({ season: 1, episode: 2, episodeTitle: 'Diversity Day' });
  });
  it('parses multi-episode files', () => {
    expect(parseEpisodePath('Show/Show.S03E04E05.mkv')).toMatchObject({ season: 3, episode: 4, episodeEnd: 5 });
  });
  it('uses the season folder when the file only has a number', () => {
    expect(parseEpisodePath('Lost/Season 1/05 - White Rabbit.mkv')).toMatchObject({ showTitle: 'Lost', season: 1, episode: 5 });
    expect(parseEpisodePath('Lost/Specials/01.mkv')).toMatchObject({ season: 0, episode: 1 });
  });
  it('derives the show title from the file name without folders', () => {
    expect(parseEpisodePath('Dark.S01E01.1080p.mkv')).toMatchObject({ showTitle: 'Dark', season: 1, episode: 1 });
  });
  it('does not mistake resolutions for episodes', () => {
    expect(parseEpisodePath('Some Show/Some.Show.1920x1080.mkv')).toBeNull();
  });
});

describe('similarity and helpers', () => {
  it('scores equal titles as 1 and ignores leading articles and punctuation', () => {
    expect(similarity('Interstellar', 'Interstellar')).toBe(1);
    expect(similarity('The Matrix', 'Matrix')).toBe(1);
    expect(similarity('Spider Man', 'Spider-Man')).toBe(1);
    expect(similarity('Interstellar', 'Inception')).toBeLessThan(0.6);
  });
  it('sorts without leading articles', () => {
    expect(sortTitle('The Matrix')).toBe('matrix');
  });
  it('parses subtitle names', () => {
    expect(parseSubtitleName('movie', 'movie.en.srt')).toMatchObject({ language: 'en', forced: false, label: 'English' });
    expect(parseSubtitleName('movie', 'movie.nl.forced.srt')).toMatchObject({ language: 'nl', forced: true });
    expect(parseSubtitleName('movie', 'movie.srt')).toMatchObject({ language: null });
    expect(parseSubtitleName('movie', 'other.en.srt')).toBeNull();
  });
});
