import { describe, expect, it } from 'vitest';
import { canRequest, canRequestTitle, catalogOnly, seasonsToRequest, DISCOVER_ROWS, openSeasons, discoverPath, discoverTarget, mergePages, toggleSeason, type SeerrResult } from './discover';

const r = (over: Partial<SeerrResult>): SeerrResult => ({ mediaType: 'movie', tmdbId: 1, title: 'X', year: null, overview: '', posterPath: null, state: null, inLibrary: false, local: null, ...over });

describe('discover', () => {
  it('asks the server for each row, genres included', () => {
    expect(discoverPath(DISCOVER_ROWS[0], 1)).toBe('/api/seerr/discover?row=trending&page=1');
    expect(discoverPath({ row: 'movies', genre: 28, title: 'discover.movieGenre' }, 3)).toBe('/api/seerr/discover?row=movies&genre=28&page=3');
    expect(new Set(DISCOVER_ROWS.map((x) => `${x.row}-${x.genre}`)).size).toBe(DISCOVER_ROWS.length);
  });

  it('opens local details for what is here, and a request page for the rest', () => {
    expect(discoverTarget(r({ local: { type: 'movie', id: 5 } }))).toBe('/movie/5');
    expect(discoverTarget(r({ mediaType: 'tv', local: { type: 'show', id: 9 } }))).toBe('/show/9');
    expect(discoverTarget(r({ mediaType: 'tv', tmdbId: 1399 }))).toBe('/request/tv/1399');
  });

  it('searches outside the library only for what is not here', () => {
    expect(catalogOnly([r({ tmdbId: 1, inLibrary: true, local: { type: 'movie', id: 5 } }), r({ tmdbId: 2 })]).map((x) => x.tmdbId)).toEqual([2]);
    expect(catalogOnly(undefined)).toEqual([]);
  });

  it('shows a title once when it comes back on a later page', () => {
    const merged = mergePages([
      { page: 1, totalPages: 2, results: [r({ tmdbId: 1 }), r({ tmdbId: 2 })] },
      { page: 2, totalPages: 2, results: [r({ tmdbId: 2 }), r({ tmdbId: 2, mediaType: 'tv' })] },
    ]);
    expect(merged.map((x) => `${x.mediaType}${x.tmdbId}`)).toEqual(['movie1', 'movie2', 'tv2']);
  });

  it('only offers a request when it makes sense', () => {
    expect(canRequest(r({}))).toBe(true);
    expect(canRequest(r({ state: 'declined' }))).toBe(true);
    expect(canRequest(r({ state: 'processing' }))).toBe(false);
    expect(canRequest(r({ inLibrary: true }))).toBe(false);
  });

  it('ticks seasons, with all of them meaning "all"', () => {
    // Nothing is ticked beforehand; a tap ticks or unticks one season.
    expect(toggleSeason([], 3, true)).toEqual([3]);
    expect(toggleSeason([1, 2], 3, true)).toEqual([1, 2, 3]);
    expect(toggleSeason([1], 1, false)).toEqual([]);
    // Sent with the request: exactly what is ticked (open seasons only), or the whole show when all are.
    expect(seasonsToRequest([], [2, 3])).toEqual([]);
    expect(seasonsToRequest([3, 1], [2, 3])).toEqual([3]);
    expect(seasonsToRequest([3, 2], [2, 3])).toBeNull();
  });

  it('requests only the seasons of a show still open', () => {
    const show = { mediaType: 'tv' as const, inLibrary: false, state: 'partiallyAvailable' as const, seasons: [{ seasonNumber: 1, episodeCount: 8, state: 'available' as const }, { seasonNumber: 2, episodeCount: 8, state: 'declined' as const }, { seasonNumber: 3, episodeCount: 8, state: null }] };
    expect(openSeasons(show)).toEqual([2, 3]);
    expect(canRequestTitle(show)).toBe(true);
    expect(canRequestTitle({ ...show, seasons: show.seasons.map((s) => ({ ...s, state: 'processing' as const })) })).toBe(false);
    // A movie, or a server that does not tell seasons apart: the title as a whole.
    expect(canRequestTitle({ mediaType: 'movie', inLibrary: false, state: 'processing', seasons: [] })).toBe(false);
    expect(canRequestTitle({ mediaType: 'tv', inLibrary: false, state: null, seasons: [] })).toBe(true);
  });
});
