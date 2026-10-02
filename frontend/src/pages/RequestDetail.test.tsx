import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequestPage } from './RequestDetail';

let role: 'admin' | 'user' = 'user';
vi.mock('../lib/auth', async (original) => ({ ...(await original<typeof import('../lib/auth')>()), useAuth: () => ({ user: { id: 1, role, username: 'anna' } }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  role = 'user';
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

const base = { overview: 'A long story.', posterPath: '/p.jpg', backdropPath: '/b.jpg', tagline: 'It begins.', rating: 8.4, releaseDate: '2011-04-17', genres: ['Drama', 'Fantasy'], runtime: null, inLibrary: false, local: null, cast: [{ id: 1, name: 'Sean Bean', character: 'Ned', profilePath: null }] };
const show = {
  ...base,
  mediaType: 'tv',
  tmdbId: 1399,
  title: 'A Show',
  year: 2011,
  state: 'partiallyAvailable',
  seasons: [
    { seasonNumber: 1, episodeCount: 10, name: null, state: 'available' },
    { seasonNumber: 2, episodeCount: 10, name: null, state: 'processing' },
    { seasonNumber: 3, episodeCount: 10, name: null, state: null },
    { seasonNumber: 4, episodeCount: 10, name: null, state: null },
  ],
};

function setup(path: string, answer: (method: string, url: string) => unknown) {
  const calls: Array<{ call: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ call: `${method} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(answer(method, url) ?? {}), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/request/:type/:id" element={<RequestPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('a title from Seerr on its own page', () => {
  it('shows the title, its cast and seasons, and requests only the seasons still open', async () => {
    const calls = setup('/request/tv/1399', (method, url) => {
      if (url === '/api/seerr/tv/1399') return show;
      if (url === '/api/seerr/tv/1399/recommendations') return { results: [{ ...base, mediaType: 'movie', tmdbId: 5, title: 'Similar One', year: 2012, state: null }] };
      if (method === 'POST') return { id: 3, title: 'A Show', state: 'requested' };
      return {};
    });
    expect(await screen.findByRole('heading', { name: 'A Show' })).toBeTruthy();
    expect(screen.getByText('It begins.')).toBeTruthy();
    expect(screen.getByText('8.4')).toBeTruthy();
    expect(screen.getByText('Sean Bean')).toBeTruthy();
    expect(await screen.findByText('Similar One')).toBeTruthy();
    // Seasons already here or on their way cannot be picked again.
    expect((screen.getByLabelText(/Season 1 ·/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Season 2 ·/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Being added')).toBeTruthy();
    await userEvent.click(screen.getByLabelText(/Season 4 ·/));
    await userEvent.click(screen.getByRole('button', { name: 'Request 1 season(s)' }));
    await vi.waitFor(() => expect(calls.find((c) => c.call === 'POST /api/seerr/requests')?.body).toEqual({ mediaType: 'tv', tmdbId: 1399, seasons: [3] }));
    // No reset for someone who is not an administrator.
    expect(screen.queryByRole('button', { name: 'Make requestable again' })).toBeNull();
  });

  it('plays what is here instead of requesting it', async () => {
    setup('/request/movie/603', (_m, url) => (url === '/api/seerr/movie/603' ? { ...base, mediaType: 'movie', tmdbId: 603, title: 'The Matrix', year: 1999, state: 'available', seasons: [], inLibrary: true, local: { type: 'movie', id: 12 } } : {}));
    await userEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(screen.getByTestId('where').textContent).toBe('/play/movie/12');
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
  });

  it('requests a movie (a movie has no seasons to tick)', async () => {
    const calls = setup('/request/movie/604', (method, url) => {
      if (url === '/api/seerr/movie/604') return { ...base, mediaType: 'movie', tmdbId: 604, title: 'The Matrix Reloaded', year: 2003, state: null, seasons: [] };
      if (method === 'POST' && url === '/api/seerr/requests') return { id: 1, mediaType: 'movie', tmdbId: 604, title: 'The Matrix Reloaded', posterPath: null, state: 'requested', createdAt: 0, updatedAt: 0 };
      return {};
    });
    const button = (await screen.findByRole('button', { name: 'Request' })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await vi.waitFor(() => expect(calls.find((c) => c.call === 'POST /api/seerr/requests')?.body).toEqual({ mediaType: 'movie', tmdbId: 604, seasons: null }));
  });

  it('lets an administrator make a stuck title requestable again, after asking', async () => {
    role = 'admin';
    const calls = setup('/request/movie/700', (_m, url) => (url === '/api/seerr/movie/700' ? { ...base, mediaType: 'movie', tmdbId: 700, title: 'The Uprising', year: 2026, state: 'processing', seasons: [] } : { ok: true }));
    expect(await screen.findByText('Being added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make requestable again' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Nothing in the library is touched/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make requestable again' }));
    await vi.waitFor(() => expect(calls.some((c) => c.call === 'DELETE /api/admin/seerr/media/movie/700')).toBe(true));
  });
});
