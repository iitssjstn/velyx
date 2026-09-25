import type { FetchLike } from '../src/services/tmdb.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

export interface MockTmdb {
  fetch: FetchLike;
  calls: string[];
  offline: boolean;
}

/** A tiny fake of the TMDB API covering the endpoints Velyx uses. */
export function createMockTmdb(validKey = 'test-key'): MockTmdb {
  const state: MockTmdb = {
    calls: [],
    offline: false,
    fetch: async (input) => {
      const url = new URL(input);
      state.calls.push(url.pathname + url.search);
      if (state.offline) throw new Error('getaddrinfo ENOTFOUND api.themoviedb.org');
      if (url.hostname === 'image.tmdb.org') return new Response(PNG, { status: 200 });
      if (url.searchParams.get('api_key') !== validKey) return json({ status_message: 'Invalid API key' }, 401);
      const p = url.pathname.replace('/3', '');
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      if (p === '/configuration') return json({ images: {} });
      if (p === '/search/movie') {
        const all = [
          { id: 157336, title: 'Interstellar', original_title: 'Interstellar', release_date: '2014-11-05', popularity: 90, poster_path: '/inter.jpg' },
          { id: 301, title: 'Interstellar Wars', original_title: 'Interstellar Wars', release_date: '2016-01-01', popularity: 2, poster_path: null },
          { id: 603, title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-30', popularity: 80, poster_path: '/matrix.jpg' },
          { id: 604, title: 'The Matrix Reloaded', original_title: 'The Matrix Reloaded', release_date: '2003-05-15', popularity: 50, poster_path: null },
        ];
        return json({ results: all.filter((r) => r.title.toLowerCase().includes(q)) });
      }
      if (p === '/search/tv') {
        const all = [{ id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20', popularity: 99, poster_path: '/bb.jpg' }];
        return json({ results: all.filter((r) => r.name.toLowerCase().includes(q)) });
      }
      const movie = /^\/movie\/(\d+)$/.exec(p);
      if (movie) {
        const id = Number(movie[1]);
        const base: Record<number, { title: string; date: string; genres: string[] }> = {
          157336: { title: 'Interstellar', date: '2014-11-05', genres: ['Adventure', 'Drama', 'Science Fiction'] },
          603: { title: 'The Matrix', date: '1999-03-30', genres: ['Action', 'Science Fiction'] },
          604: { title: 'The Matrix Reloaded', date: '2003-05-15', genres: ['Action'] },
        };
        const m = base[id];
        if (!m) return json({ status_message: 'not found' }, 404);
        return json({
          id,
          title: m.title,
          original_title: m.title,
          overview: `${m.title} overview`,
          tagline: 'Tagline',
          runtime: 169,
          release_date: m.date,
          vote_average: 8.4,
          vote_count: 30000,
          poster_path: `/${id}-poster.jpg`,
          backdrop_path: `/${id}-backdrop.jpg`,
          imdb_id: `tt${id}`,
          genres: m.genres.map((name, i) => ({ id: i + 1, name })),
          credits: {
            cast: [
              { id: 10297, name: 'Matthew McConaughey', character: 'Cooper', profile_path: '/mm.jpg', order: 0 },
              { id: 1813, name: 'Anne Hathaway', character: 'Brand', profile_path: null, order: 1 },
            ],
            crew: [{ id: 525, name: 'Christopher Nolan', job: 'Director', profile_path: null }],
          },
        });
      }
      if (p === '/tv/1396')
        return json({
          id: 1396,
          name: 'Breaking Bad',
          original_name: 'Breaking Bad',
          overview: 'A chemistry teacher...',
          first_air_date: '2008-01-20',
          status: 'Ended',
          vote_average: 8.9,
          poster_path: '/bb.jpg',
          backdrop_path: '/bb-back.jpg',
          genres: [{ id: 18, name: 'Drama' }],
          networks: [{ name: 'AMC' }],
          episode_run_time: [47],
          credits: { cast: [{ id: 17419, name: 'Bryan Cranston', character: 'Walter White', profile_path: null, order: 0 }], crew: [] },
          external_ids: { imdb_id: 'tt0903747', tvdb_id: 81189 },
        });
      const season = /^\/tv\/1396\/season\/(\d+)$/.exec(p);
      if (season) {
        const n = Number(season[1]);
        return json({
          season_number: n,
          name: `Season ${n}`,
          overview: `Season ${n} overview`,
          air_date: '2008-01-20',
          poster_path: `/bb-s${n}.jpg`,
          episodes: [1, 2, 3].map((e) => ({
            episode_number: e,
            season_number: n,
            name: `Episode title ${n}x${e}`,
            overview: 'Episode overview',
            air_date: '2008-01-20',
            runtime: 58,
            vote_average: 8,
            still_path: `/still-${n}-${e}.jpg`,
          })),
        });
      }
      return json({ status_message: 'not found' }, 404);
    },
  };
  return state;
}
