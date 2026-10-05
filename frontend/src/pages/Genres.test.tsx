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
  it('shows only local genres with visible titles and links to the filtered library', async () => {
    setup('/genres?scope=library&kind=movies', (url) => url === '/api/genres?type=movies' ? [{ id: 18, name: 'Drama', count: 4 }] : null);
    expect(await screen.findByText('Drama')).toBeTruthy();
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