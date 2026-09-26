import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './Home';
import type { ContinueItem, HomeData } from '../lib/types';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user', username: 'anna' } }), displayName: () => 'Anna' }));
afterEach(() => vi.unstubAllGlobals());

const episode: ContinueItem = { type: 'episode', id: 42, title: 'Reacher', subtitle: 'S2 E4', imagePath: null, posterPath: null, showId: 7, seasonNumber: 2, episodeNumber: 4, episodeTitle: null, upNext: false, progress: { positionSec: 1934, durationSec: 2901 }, percent: 67, updatedAt: 2 };
const movie: ContinueItem = { ...episode, type: 'movie', id: 3, title: 'Dune', subtitle: '2021', showId: null, seasonNumber: null, episodeNumber: null, progress: { positionSec: 3600, durationSec: 9360 }, percent: 38, updatedAt: 1 };

function setup() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const home: HomeData = { hero: episode, continueWatching: [episode, movie], recentlyAdded: [], recentlyWatched: [], movies: [], shows: [], favorites: [], watchlist: [], counts: { movies: 1, shows: 1, libraries: 2 } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(url === '/api/home' ? home : { ok: true }), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('Home — Continue Watching', () => {
  it('leads with the most recent item: where you are, Resume and Start over', async () => {
    setup();
    expect(await screen.findByText('Pick up where you left off')).toBeTruthy();
    const hero = screen.getByText('Pick up where you left off').parentElement!;
    expect(within(hero).getByText('Season 2 · Episode 4')).toBeTruthy();
    expect(within(hero).getByText('32:14 / 48:21')).toBeTruthy();
    expect(within(hero).getByRole('link', { name: 'Resume' }).getAttribute('href')).toBe('/play/episode/42?t=1934');
    expect(within(hero).getByRole('link', { name: 'Start over' }).getAttribute('href')).toBe('/play/episode/42?t=0');
  });

  it('marks an item watched or removes it from the row', async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Dune, 2021' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as watched' }));
    expect(calls.find((c) => c.url === '/api/progress/watched')?.body).toEqual({ movieId: 3, watched: true });
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Reacher, Season 2 · Episode 4' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from Continue Watching' }));
    expect(calls.find((c) => c.url === '/api/home/continue/dismiss')?.body).toEqual({ type: 'episode', id: 42 });
  });
});
