import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShowPage } from './ShowDetail';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user', username: 'anna' } }) }));
afterEach(() => vi.unstubAllGlobals());

const season = (n: number, name: string, count: number, watched: number) => ({ id: 100 + n, seasonNumber: n, name, overview: null, airDate: null, posterPath: null, episodeCount: count, watchedCount: watched, percentWatched: Math.round((watched / count) * 100) });
const show = {
  id: 7, type: 'show', title: 'Reacher', originalTitle: null, year: 2022, overview: 'Jack Reacher…', firstAirDate: null, status: 'Returning Series', network: 'Prime', rating: 8.0,
  posterPath: null, backdropPath: null, tmdbId: null, imdbId: null, match: { status: 'matched', confidence: 1, parsedTitle: 'Reacher', parsedYear: null },
  genres: [], cast: [], crew: [], collections: [], favorite: false, watchlist: false,
  seasons: [season(1, 'Season 1', 8, 8), season(2, 'Season 2', 8, 3), season(0, 'Specials', 1, 0)],
  episodeCount: 17, watchedCount: 11, percentWatched: 65,
  upNext: { id: 24, seasonNumber: 2, episodeNumber: 4, title: 'A Night at the Motel', durationSec: 2901, progress: { positionSec: 1934, durationSec: 2901, completed: false } },
};
const episode = (n: number, progress: object | null, title: string | null = `Episode title ${n}`) => ({ id: 20 + n, seasonNumber: 2, episodeNumber: n, title, overview: null, airDate: null, runtime: 47, rating: null, stillPath: null, durationSec: 2820, height: 1080, progress });
const season2 = {
  id: 102, seasonNumber: 2, name: 'Season 2', overview: null, posterPath: null,
  episodes: [episode(1, { positionSec: 0, durationSec: 2820, completed: true }), episode(4, { positionSec: 1934, durationSec: 2844, completed: false }), episode(5, null, null)],
};

function setup() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/shows/7') return new Response(JSON.stringify(show), { status: 200 });
    if (url === '/api/shows/7/seasons/2') return new Response(JSON.stringify(season2), { status: 200 });
    if (url.includes('/similar')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/shows/7']}>
        <Routes>
          <Route path="/shows/:id" element={<ShowPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('series page', () => {
  it('shows seasons, episodes, how much is watched, and where to continue', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Reacher' })).toBeTruthy();
    expect(screen.getByText('2 seasons')).toBeTruthy();
    expect(screen.getByText('17 episodes')).toBeTruthy();
    expect(screen.getByText('65% watched')).toBeTruthy();
    expect(screen.getByText(/A Night at the Motel ·/)).toBeTruthy();
    expect(screen.getByText('32:14 / 48:21')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Resume S02E04' }).getAttribute('href')).toBe('/play/episode/24?t=1934');
    expect(screen.getByRole('link', { name: 'Start over' }).getAttribute('href')).toBe('/play/episode/24?t=0');
    // Seasons in order with specials last; the season to continue in is open.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Season 1', 'Season 2', 'Specials']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('lists episodes with code, title, length, state and a direct Play or Resume', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Episodes' });
    expect(within(list).getByText('S02E04 · Episode title 4')).toBeTruthy();
    expect(within(list).getAllByText('47m').length).toBe(3);
    expect(within(list).getByText('68% watched')).toBeTruthy();
    expect(within(list).getByText('Watched')).toBeTruthy();
    // No title: just the code.
    expect(within(list).getByText('S02E05')).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Resume S02E04 · Episode title 4' }).getAttribute('href')).toBe('/play/episode/24?t=1934');
    expect(within(list).getByRole('link', { name: 'Play S02E05' }).getAttribute('href')).toBe('/play/episode/25?t=0');
    expect(screen.getByText('8 episodes · 38% watched')).toBeTruthy();
  });

  it('marks an episode watched from the list', async () => {
    const calls = setup();
    const list = await screen.findByRole('list', { name: 'Episodes' });
    await userEvent.click(within(list).getByRole('button', { name: 'Mark S02E05 as watched' }));
    expect(calls.find((c) => c.url === '/api/progress/watched')?.body).toEqual({ episodeId: 25, watched: true });
  });
});
