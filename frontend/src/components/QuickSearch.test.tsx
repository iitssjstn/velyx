import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './Layout';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user', username: 'anna' }, logout: vi.fn() }), displayName: () => 'Anna' }));
afterEach(() => vi.unstubAllGlobals());

const results = {
  query: 'rea',
  movies: [{ type: 'movie', id: 1, title: 'Real Steel', year: 2011, posterPath: null, runtime: 127 }],
  shows: [{ type: 'show', id: 3, title: 'Reacher', year: 2022, posterPath: null, seasonCount: 2, episodeCount: 16 }],
  episodes: [{ id: 9, showId: 3, showTitle: 'Reacher', seasonNumber: 2, episodeNumber: 4, title: 'A Night at the Motel', stillPath: null, progress: null }],
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function setup(body: object = results) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return urls;
}

describe('global search', () => {
  it('opens with Ctrl+K and "/", searches once per pause in typing, and shows each kind', async () => {
    const urls = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search Velyx' });
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, 'rea');
    expect(await screen.findByRole('option', { name: /^Real Steel/ })).toBeTruthy();
    expect(urls.filter((u) => u.startsWith('/api/search'))).toEqual(['/api/search?q=rea']);
    expect(screen.getByRole('option', { name: 'Reacher S02E04 A Night at the Motel' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reacher 2022 · 2 seasons' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /All results for “rea” \(3\)/ })).toBeTruthy();
    await userEvent.keyboard('{Escape}{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Search Velyx' })).toBeNull();
    await userEvent.keyboard('/');
    expect(screen.getByRole('dialog', { name: 'Search Velyx' })).toBeTruthy();
  });

  it('moves through results with the arrow keys and opens one with Enter', async () => {
    setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Search Velyx' })[0]);
    await userEvent.type(screen.getByRole('combobox'), 'rea');
    await screen.findByRole('option', { name: /^Real Steel/ });
    expect(screen.getByRole('option', { name: /Real Steel/ }).getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { name: /Reacher S02E04/ }).getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('where').textContent).toBe('/play/episode/9');
    expect(screen.queryByRole('dialog', { name: 'Search Velyx' })).toBeNull();
  });

  it('goes to all results from the last row, and says when nothing is found', async () => {
    setup({ query: 'zzz', movies: [], shows: [], episodes: [] });
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('Nothing found for “zzz”.')).toBeTruthy();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/search?q=zzz'));
  });

  it('does not open on "/" while typing in a field', async () => {
    setup();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await act(async () => {
      await userEvent.keyboard('/');
    });
    expect(screen.queryByRole('dialog', { name: 'Search Velyx' })).toBeNull();
    field.remove();
  });
});
