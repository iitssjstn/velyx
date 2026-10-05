import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { GenresPage } from './Genres';

afterEach(() => vi.unstubAllGlobals());

function Where() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function setup(path: string, answer: (url: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(answer(url)), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/movies" element={<Where />} />
          <Route path="/movies/:id" element={<Where />} />
          <Route path="/shows" element={<Where />} />
          <Route path="/request/:type/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('genre categories', () => {
  it('combines library and Seerr genres and suppresses Seerr titles already in the library', async () => {
    const calls = setup('/genres?kind=movies', (url) => {
      if (url === '/api/genres?type=movies') return [{ id: 4, name: 'Drama', count: 1 }, { id: 8, name: 'Independent', count: 2 }];
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies&genre=18')) return { page: 1, totalPages: 1, results: [
        { mediaType: 'movie', tmdbId: 11, title: 'Away Drama', year: 2024, overview: '', posterPath: null, state: null, inLibrary: false, local: null },
        { mediaType: 'movie', tmdbId: 22, title: 'Local Drama', year: 2023, overview: '', posterPath: null, state: null, inLibrary: true, local: { type: 'movie', id: 41 } },
      ] };
      if (url.startsWith('/api/seerr/discover?row=movies&genre=28')) return { page: 1, totalPages: 1, results: [{ mediaType: 'movie', tmdbId: 33, title: 'Action Film', year: 2022, overview: '', posterPath: null, state: null, inLibrary: false, local: null }] };
      if (url.startsWith('/api/movies?') && url.includes('genre=4')) return { items: [{ type: 'movie', id: 41, title: 'Local Drama', year: 2023, posterPath: null, backdropPath: null, rating: null, runtime: 90, overview: null, genres: ['Drama'], addedAt: 0, progress: null, favorite: false }], total: 1, page: 1, pageSize: 60 };
      return { page: 1, totalPages: 1, results: [] };
    });

    expect(await screen.findByRole('button', { name: 'Action' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Drama/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Independent/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Drama/ }));
    expect(await screen.findByRole('link', { name: /Local Drama/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Away Drama/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Local Drama/ })).toBeNull();
    expect(calls.some((url) => url.includes('/api/movies?') && url.includes('genre=4'))).toBe(true);
  });

  it('keeps the combined view useful when Seerr is disabled', async () => {
    setup('/genres?kind=movies', (url) => {
      if (url === '/api/genres?type=movies') return [{ id: 4, name: 'Drama', count: 1 }];
      if (url === '/api/seerr') return { enabled: false };
      return null;
    });
    expect(await screen.findByRole('button', { name: /Drama/ })).toBeTruthy();
    expect(screen.queryByText('Seerr is not connected')).toBeNull();
  });

  it('shows only local genres with visible titles and links to the filtered library', async () => {
    setup('/genres?scope=library&kind=movies', (url) => url === '/api/genres?type=movies' ? [{ id: 18, name: 'Drama', count: 4 }] : null);
    expect(await screen.findByRole('link', { name: /Drama/ })).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: /Drama/ }));
    expect(screen.getByText('/movies?genre=18')).toBeTruthy();
  });

  it('shows Seerr categories with results and opens their matching detail page', async () => {
    setup('/genres?scope=seerr&kind=movies', (url) => {
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies&genre=28')) return { page: 1, totalPages: 1, results: [{ mediaType: 'movie', tmdbId: 550, title: 'Alien', year: 1979, overview: '', posterPath: null, state: null, inLibrary: false, local: null }] };
      if (url.startsWith('/api/seerr/discover?row=movies&genre=28&page=1')) return { page: 1, totalPages: 1, results: [{ mediaType: 'movie', tmdbId: 550, title: 'Alien', year: 1979, overview: '', posterPath: null, state: null, inLibrary: false, local: null }] };
      return { page: 1, totalPages: 1, results: [] };
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Action' }));
    await userEvent.click(await screen.findByRole('button', { name: /Alien/ }));
    expect(screen.getByText('/request/movie/550')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Comedy' })).toBeNull();
  });

  it('opens local metadata when a Seerr genre title is already in the library', async () => {
    setup('/genres?scope=seerr&kind=movies', (url) => {
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies&genre=28')) return { page: 1, totalPages: 1, results: [{ mediaType: 'movie', tmdbId: 550, title: 'Alien', year: 1979, overview: '', posterPath: null, state: null, inLibrary: true, local: { type: 'movie', id: 5 } }] };
      return { page: 1, totalPages: 1, results: [] };
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Action' }));
    await userEvent.click(await screen.findByRole('button', { name: /Alien/ }));
    expect(screen.getByText('/movies/5')).toBeTruthy();
  });

  it('reports when Seerr is disabled', async () => {
    setup('/genres?scope=seerr&kind=movies', (url) => url === '/api/seerr' ? { enabled: false } : null);
    expect(await screen.findByText('Seerr is not connected')).toBeTruthy();
  });
});