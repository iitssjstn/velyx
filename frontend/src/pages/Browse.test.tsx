import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BrowsePage, activeFilterChips } from './Browse';
import { gridLayout, visibleRows } from '../components/VirtualGrid';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }));

afterEach(() => vi.unstubAllGlobals());

function renderBrowse(url = '/movies') {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input);
      const body = input.startsWith('/api/genres') ? [{ id: 3, name: 'Drama', count: 2 }] : { items: [], total: 0, page: 1, pageSize: 60 };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <BrowsePage kind="movies" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('library filters UI', () => {
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
