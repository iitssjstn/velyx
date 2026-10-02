import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from './Search';

afterEach(() => vi.unstubAllGlobals());

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const library = { query: 'matrix', movies: [{ type: 'movie', id: 12, title: 'The Matrix', year: 1999, posterPath: null, backdropPath: null, rating: null, runtime: 136, overview: null, genres: [], addedAt: 0, progress: null, favorite: false }], shows: [], episodes: [] };
const outside = (tmdbId: number, title: string, inLibrary = false) => ({ mediaType: 'movie', tmdbId, title, year: 2003, overview: '', posterPath: null, state: null, inLibrary, local: inLibrary ? { type: 'movie', id: 12 } : null });

function setup(seerr: boolean) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const body = url.startsWith('/api/search') ? library : url === '/api/seerr' ? { enabled: seerr } : url.startsWith('/api/seerr/search') ? { page: 1, totalPages: 1, results: [outside(603, 'The Matrix', true), outside(604, 'The Matrix Reloaded')] } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/search?q=matrix']}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return urls;
}

describe('search', () => {
  it('shows the library first and then what is not in the library, which opens its page to request it', async () => {
    setup(true);
    expect(await screen.findByText('Not in the library')).toBeTruthy();
    // Outside the library: The Matrix Reloaded. The Matrix is here, so it is listed only with the library.
    const cards = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Matrix'));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain('The Matrix Reloaded');
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/movies/12')).toHaveLength(1);
    await userEvent.click(cards[0]!);
    expect(screen.getByTestId('where').textContent).toBe('/request/movie/604');
  });

  it('only searches the library without Seerr', async () => {
    const urls = setup(false);
    await vi.waitFor(() => expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/movies/12')).toBe(true));
    expect(screen.queryByText('Not in the library')).toBeNull();
    expect(urls.some((u) => u.startsWith('/api/seerr/search'))).toBe(false);
  });
});
