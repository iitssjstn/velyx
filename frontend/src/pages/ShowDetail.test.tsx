import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
  episodes: [episode(1, { positionSec: 0, durationSec: 2820, completed: true }), episode(4, { positionSec: 1934, durationSec: 2844, completed: false }), { ...episode(5, null, null), width: 1920, height: 800 }],
};

// What Seerr knows of the show: seasons 1 and 2 are here (the server marks them), 3 is not.
const seerrShow = {
  mediaType: 'tv', tmdbId: 1399, title: 'Reacher', year: 2022, overview: '', posterPath: null, backdropPath: null, tagline: null, rating: null, releaseDate: null, runtime: null, genres: [], cast: [],
  state: 'partiallyAvailable', inLibrary: true, local: { type: 'show', id: 7 },
  seasons: [
    { seasonNumber: 1, episodeCount: 8, name: null, state: 'available' },
    { seasonNumber: 2, episodeCount: 8, name: null, state: 'available' },
    { seasonNumber: 3, episodeCount: 8, name: null, state: null },
  ],
};

function setup(opts: { tmdbId?: number; seerr?: boolean; seasonOverview?: string; open?: boolean } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/shows/7') return new Response(JSON.stringify({ ...show, tmdbId: opts.tmdbId ?? null }), { status: 200 });
    if (url === '/api/seerr') return new Response(JSON.stringify({ enabled: opts.seerr ?? false }), { status: 200 });
    if (url === '/api/seerr/tv/1399/open') return new Response(JSON.stringify({ open: opts.open ?? true }), { status: 200 });
    if (url === '/api/seerr/tv/1399') return new Response(JSON.stringify(seerrShow), { status: 200 });
    if (url === '/api/seerr/requests') return new Response(JSON.stringify({ id: 3, title: 'Reacher', state: 'requested' }), { status: 200 });
    if (url === '/api/shows/7/seasons/2') return new Response(JSON.stringify({ ...season2, overview: opts.seasonOverview ?? null }), { status: 200 });
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
  it('requests the seasons that are not here yet on the show page itself, with Seerr', async () => {
    const calls = setup({ tmdbId: 1399, seerr: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Request seasons' }));
    // The same question as on a request page, without leaving this page.
    const dialog = await screen.findByRole('dialog', { name: 'Request “Reacher”?' });
    expect(screen.getByRole('heading', { name: 'Reacher' })).toBeTruthy();
    expect((within(dialog).getByLabelText(/Season 1 ·/) as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText(/Season 2 ·/) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByLabelText(/Season 3 ·/));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Request/ }));
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/seerr/requests')?.body).toEqual({ mediaType: 'tv', tmdbId: 1399, seasons: null }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers no requests when every season is here or requested already', async () => {
    const calls = setup({ tmdbId: 1399, seerr: true, open: false });
    expect(await screen.findByRole('heading', { name: 'Reacher' })).toBeTruthy();
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/seerr/tv/1399/open')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Request seasons' })).toBeNull();
  });

  it('offers no requests without Seerr', async () => {
    setup({ tmdbId: 1399, seerr: false });
    expect(await screen.findByRole('heading', { name: 'Reacher' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request seasons' })).toBeNull();
  });

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

  it('leaves out a season description that repeats the show description, and shows one of its own', async () => {
    setup({ seasonOverview: 'JACK REACHER…  ' });
    await screen.findByRole('list', { name: 'Episodes' });
    expect(screen.getAllByText(/Jack Reacher…/i)).toHaveLength(1);
    cleanup();
    setup({ seasonOverview: 'Reacher goes to New York.' });
    expect(await screen.findByText('Reacher goes to New York.')).toBeTruthy();
  });

  it('labels a wide 1080p episode (1920×800, no black bars) as 1080p, not 720p', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Episodes' });
    const row = within(list).getByText('S02E05').closest('li')!;
    expect(within(row as HTMLElement).getByText('1080p')).toBeTruthy();
    expect(within(row as HTMLElement).queryByText('720p')).toBeNull();
  });

  it('marks an episode watched from the list', async () => {
    const calls = setup();
    const list = await screen.findByRole('list', { name: 'Episodes' });
    await userEvent.click(within(list).getByRole('button', { name: 'Mark S02E05 as watched' }));
    expect(calls.find((c) => c.url === '/api/progress/watched')?.body).toEqual({ episodeId: 25, watched: true });
  });
});
