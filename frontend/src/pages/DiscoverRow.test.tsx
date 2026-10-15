import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiscoverRowPage } from './DiscoverRow';

afterEach(() => vi.unstubAllGlobals());

const result = (over: Record<string, unknown>) => ({ mediaType: 'movie', year: 2026, overview: '', posterPath: null, state: null, inLibrary: false, local: null, ...over });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function setup(path: string, enabled = true) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (url === '/api/seerr') return json({ enabled });
    if (url === '/api/seerr/discover?row=upcomingMovies&page=1') return json({ page: 1, totalPages: 1, results: [result({ tmdbId: 1, title: 'Soon Movie' }), result({ tmdbId: 2, title: 'Here Movie', inLibrary: true, local: { type: 'movie', id: 5 } })] });
    return json({ page: 1, totalPages: 1, results: [] });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/discover/:row" element={<DiscoverRowPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('a catalog row in full', () => {
  it('shows the row with its title, and opens a title from it', async () => {
    setup('/discover/upcomingMovies');
    expect(await screen.findByRole('heading', { name: 'Movies coming soon' })).toBeTruthy();
    expect((await screen.findAllByText('Soon Movie'))[0]).toBeTruthy();
    expect(screen.getAllByTitle('In the library')).toHaveLength(1);
    await userEvent.click(screen.getAllByText('Soon Movie')[0]);
    expect(screen.getByTestId('where').textContent).toBe('/request/movie/1');
  });

  it('says so when Seerr is not connected, without asking for the row', async () => {
    const calls = setup('/discover/trending', false);
    expect(await screen.findByText('Seerr is not connected')).toBeTruthy();
    expect(calls.some((c) => c.startsWith('/api/seerr/discover'))).toBe(false);
  });

  it('says so when the row is empty', async () => {
    setup('/discover/trending');
    expect(await screen.findByText('Nothing here right now.')).toBeTruthy();
  });

  it('only knows the rows that have no page elsewhere', async () => {
    const calls = setup('/discover/account');
    expect(await screen.findByText('404')).toBeTruthy();
    expect(calls.some((c) => c.startsWith('/api/seerr/discover'))).toBe(false);
  });
});
