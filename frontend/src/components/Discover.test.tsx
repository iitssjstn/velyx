import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DISCOVER_ROWS, DiscoverShelves } from './Discover';

afterEach(() => vi.unstubAllGlobals());

const result = (over: Record<string, unknown>) => ({ mediaType: 'movie', year: 2020, overview: '', posterPath: null, state: null, inLibrary: false, local: null, ...over });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function setup(enabled: boolean) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (url === '/api/seerr') return json({ enabled });
      if (url.startsWith('/api/seerr/discover?row=trending&page=1'))
        return json({
          page: 1,
          totalPages: 1,
          results: [
            result({ tmdbId: 1, title: 'Here Movie', inLibrary: true, local: { type: 'movie', id: 5 } }),
            result({ tmdbId: 2, mediaType: 'tv', title: 'Here Show', inLibrary: true, local: { type: 'show', id: 9 } }),
            result({ tmdbId: 3, title: 'Not Here', state: 'processing' }),
            result({ tmdbId: 4, title: 'Wanted' }),
          ],
        });
      if (url.startsWith('/api/seerr/discover')) return json({ page: 1, totalPages: 1, results: [] });
      if (url === '/api/shows/9') return json({ id: 9, upNext: { id: 77, seasonNumber: 1, episodeNumber: 3, title: null, durationSec: 1500, progress: null }, watchedCount: 2, episodeCount: 8 });
      if (url === '/api/seerr/movie/4') return json({ ...result({ tmdbId: 4, title: 'Wanted' }), genres: ['Drama'], runtime: 100, seasons: [] });
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DiscoverShelves />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('Discover rows on the home screen', () => {
  it('shows nothing and asks nothing more without Seerr', async () => {
    const calls = setup(false);
    await vi.waitFor(() => expect(calls).toContain('/api/seerr'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.startsWith('/api/seerr/discover'))).toEqual([]);
    expect(screen.queryByText('Trending now')).toBeNull();
  });

  it('shows the catalog in rows and leaves out empty ones', async () => {
    const calls = setup(true);
    expect((await screen.findAllByText('Here Movie'))[0]).toBeTruthy();
    expect(screen.getByText('Titles below may not be in your library yet.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Explore the catalog' })).toBeTruthy();
    expect(screen.getByText('Trending now')).toBeTruthy();
    expect(screen.getByText('Being added')).toBeTruthy();
    expect(screen.getAllByTitle('In the library')).toHaveLength(2);
    await vi.waitFor(() => expect(calls.filter((c) => c.startsWith('/api/seerr/discover')).length).toBe(DISCOVER_ROWS.length));
    expect(calls).toContain('/api/seerr/discover?row=movies&genre=28&page=1');
    await vi.waitFor(() => expect(screen.queryByText('Popular movies')).toBeNull());
  });

  it('opens a movie that Seerr says is here on its local metadata page', async () => {
    setup(true);
    await userEvent.click((await screen.findAllByText('Here Movie'))[0]);
    expect(screen.getByTestId('where').textContent).toBe('/movies/5');
  });

  it('opens a series that Seerr says is here on its local metadata page', async () => {
    setup(true);
    await userEvent.click((await screen.findAllByText('Here Show'))[0]);
    expect((await screen.findByTestId('where')).textContent).toBe('/shows/9');
  });

  it('opens the page of what is not here, to request it', async () => {
    setup(true);
    await userEvent.click((await screen.findAllByText('Wanted'))[0]);
    expect((await screen.findByTestId('where')).textContent).toBe('/request/movie/4');
  });
});
