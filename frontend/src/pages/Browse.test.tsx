import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BrowsePage, activeFilterChips } from './Browse';
import { gridLayout, visibleRows } from '../components/VirtualGrid';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderBrowse(url = '/movies', answer: (input: string) => unknown = (input) => input.startsWith('/api/genres') ? [{ id: 3, name: 'Drama', count: 2 }] : input === '/api/seerr' ? { enabled: false } : { items: [], total: 0, page: 1, pageSize: 60 }, kind: 'movies' | 'shows' = 'movies') {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input);
      const body = answer(input);
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
          <BrowsePage kind={kind} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('library filters UI', () => {
  it('shows library and Seerr cards in one grid without local duplicates', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const calls = renderBrowse('/movies', (url) => {
      if (url.startsWith('/api/genres')) return [{ id: 3, name: 'Drama', count: 1 }];
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies')) return { page: 1, totalPages: 1, results: [
        { mediaType: 'movie', tmdbId: 10, title: 'In Library', year: 2023, overview: '', posterPath: null, state: null, inLibrary: true, local: { type: 'movie', id: 4 } },
        { mediaType: 'movie', tmdbId: 20, title: 'Outside Catalog', year: 2024, overview: '', posterPath: null, state: null, inLibrary: false, local: null },
      ] };
      if (url.startsWith('/api/movies')) return { items: [{ type: 'movie', id: 4, title: 'In Library', year: 2023, posterPath: null, backdropPath: null, rating: null, runtime: 90, overview: null, genres: ['Drama'], addedAt: 0, progress: null, favorite: false }], total: 1, page: 1, pageSize: 60 };
      return { items: [], total: 0, page: 1, pageSize: 60 };
    });

    expect(await screen.findByRole('link', { name: /In Library/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Outside Catalog/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /In Library/ })).toBeNull();
    expect(calls.some((url) => url.startsWith('/api/seerr/discover?row=movies'))).toBe(true);
  });

  it('loads TV Seerr results on the series page', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const calls = renderBrowse('/shows', (url) => {
      if (url.startsWith('/api/genres')) return [];
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=tv')) return { page: 1, totalPages: 1, results: [{ mediaType: 'tv', tmdbId: 42, title: 'Catalog Series', year: 2024, overview: '', posterPath: null, state: null, inLibrary: false, local: null }] };
      return { items: [], total: 0, page: 1, pageSize: 60 };
    }, 'shows');
    expect(await screen.findByRole('button', { name: /Catalog Series/ })).toBeTruthy();
    expect(calls.some((url) => url.startsWith('/api/seerr/discover?row=tv'))).toBe(true);
    expect(calls.some((url) => url.startsWith('/api/seerr/discover?row=movies'))).toBe(false);
  });

  it('can show Seerr alone without requesting the local library list', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const calls = renderBrowse('/movies?source=seerr', (url) => {
      if (url.startsWith('/api/genres')) return [];
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies')) return { page: 1, totalPages: 1, results: [{ mediaType: 'movie', tmdbId: 20, title: 'Outside Catalog', year: 2024, overview: '', posterPath: null, state: null, inLibrary: false, local: null }] };
      return { items: [], total: 0, page: 1, pageSize: 60 };
    });
    expect(await screen.findByRole('button', { name: /Outside Catalog/ })).toBeTruthy();
    expect(calls.some((url) => url.startsWith('/api/movies'))).toBe(false);
  });

  it('shows the filter panel for Seerr and applies genre, year and rating filters', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const calls = renderBrowse('/movies?source=seerr', (url) => {
      if (url.startsWith('/api/genres')) return [];
      if (url === '/api/seerr') return { enabled: true };
      if (url.startsWith('/api/seerr/discover?row=movies')) return { page: 1, totalPages: 1, results: [
        { mediaType: 'movie', tmdbId: 1, title: 'Action Winner', year: 2022, rating: 8, overview: '', posterPath: null, state: null, inLibrary: false, local: null },
        { mediaType: 'movie', tmdbId: 2, title: 'Old Action', year: 1990, rating: 8, overview: '', posterPath: null, state: null, inLibrary: false, local: null },
        { mediaType: 'movie', tmdbId: 3, title: 'Low Rated Action', year: 2022, rating: 4, overview: '', posterPath: null, state: null, inLibrary: false, local: null },
      ] };
      return { items: [], total: 0, page: 1, pageSize: 60 };
    });

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = within(screen.getByRole('dialog', { name: 'Filters' }));
    expect(panel.getByText('Watched status, resolution and HDR only apply to files in your library.')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Unwatched' }).closest('fieldset')?.hasAttribute('disabled')).toBe(true);
    await userEvent.selectOptions(panel.getByLabelText('Genre'), '28');
    await userEvent.selectOptions(panel.getByLabelText('Rating'), '7');
    await userEvent.type(panel.getByLabelText('Year from'), '2000');
    await userEvent.click(panel.getByRole('button', { name: 'Show results' }));

    expect(await screen.findByRole('button', { name: /Action Winner/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Old Action/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Low Rated Action/ })).toBeNull();
    expect(calls.some((url) => url.includes('/api/seerr/discover?row=movies&genre=28'))).toBe(true);
  });

  it('sends filters and sorting to the server', async () => {
    const calls = renderBrowse();
    await screen.findByText('No movies yet');
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'runtime');
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unwatched' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '4K' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'HDR' }));
    await userEvent.type(within(dialog).getByLabelText('Year from'), '1990');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }));
    await screen.findByText('Nothing matches these filters');
    const last = calls.filter((c) => c.startsWith('/api/movies')).at(-1)!;
    const sp = new URL(last, 'http://x').searchParams;
    expect(Object.fromEntries(sp)).toMatchObject({ sort: 'runtime', filter: 'unwatched', resolution: '4k', hdr: '1', yearFrom: '1990' });
    // Active filters are shown as removable chips.
    const active = screen.getByLabelText('Active filters');
    expect(within(active).getByRole('button', { name: 'Remove filter 4K' })).toBeTruthy();
    await userEvent.click(within(active).getByRole('button', { name: 'Remove filter 4K' }));
    const after = new URL(calls.filter((c) => c.startsWith('/api/movies')).at(-1)!, 'http://x').searchParams;
    expect(after.get('resolution')).toBeNull();
    expect(after.get('hdr')).toBe('1');
  });

  it('describes active filters', () => {
    const chips = activeFilterChips(new URLSearchParams('filter=completed&genre=3&yearFrom=1990&yearTo=1999&minRating=7'), 'shows', [{ id: 3, name: 'Drama', count: 1 }]);
    expect(chips.map((c) => c.label)).toEqual(['Completed', 'Drama', '1990–1999', 'Rating 7+']);
  });
});

describe('virtual grid maths', () => {
  it('fits columns like the CSS auto-fill grid', () => {
    expect(gridLayout(1000, 160, 16, (w) => w * 1.5)).toMatchObject({ columns: 5 });
    expect(gridLayout(343, 136, 16, (w) => w)).toMatchObject({ columns: 2 });
    expect(gridLayout(50, 136, 16, (w) => w).columns).toBe(1);
  });

  it('renders only rows near the viewport', () => {
    // 1,000 rows of 300px; viewport at row 100.
    expect(visibleRows({ scrollY: 30_000 + 200, viewportHeight: 900, offsetTop: 200 }, 300, 1000)).toEqual({ first: 98, last: 105 });
    expect(visibleRows({ scrollY: 0, viewportHeight: 900, offsetTop: 200 }, 300, 1000)).toEqual({ first: 0, last: 4 });
    expect(visibleRows({ scrollY: 0, viewportHeight: 900, offsetTop: 0 }, 300, 0)).toEqual({ first: 0, last: -1 });
  });
});
