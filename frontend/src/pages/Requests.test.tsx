import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequestsPage } from './Requests';
import { RequestPage } from './RequestDetail';
import { SeerrSettings } from './admin/SeerrSettings';

let role: 'admin' | 'user' = 'user';
vi.mock('../lib/auth', async (original) => ({ ...(await original<typeof import('../lib/auth')>()), useAuth: () => ({ user: { id: 1, role, username: 'anna' } }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  role = 'user';
});

function setup(ui: React.ReactNode, answer: (method: string, url: string, body: unknown) => unknown) {
  const calls: Array<{ call: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ call: `${method} ${url}`, body });
    const r = answer(method, url, body);
    return new Response(JSON.stringify(r ?? {}), { status: 200 });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Routes><Route path="/" element={ui} /><Route path="/request/:type/:id" element={<RequestPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return calls;
}

const matrix = { mediaType: 'movie', tmdbId: 603, title: 'The Matrix', year: 1999, overview: 'A hacker learns…', posterPath: '/matrix.jpg', state: null, inLibrary: false };
const show = { mediaType: 'tv', tmdbId: 1399, title: 'A Show', year: 2011, overview: 'Families fight…', posterPath: null, state: 'processing', inLibrary: false };

describe('requests through Seerr', () => {
  it('searches, shows what is in the library already, and requests chosen seasons', async () => {
    const calls = setup(<RequestsPage />, (method, url) => {
      if (url === '/api/seerr') return { enabled: true };
      if (url === '/api/seerr/requests' && method === 'GET') return [{ id: 1, mediaType: 'movie', tmdbId: 1, title: 'Old Request', posterPath: null, state: 'declined', createdAt: 0 }];
      if (url.startsWith('/api/seerr/search')) return { results: [matrix, show, { ...matrix, tmdbId: 550, title: 'Already Here', inLibrary: true }] };
      if (url === '/api/seerr/tv/1399') return { ...show, state: null, genres: ['Drama'], runtime: null, seasons: [{ seasonNumber: 1, episodeCount: 10, name: null, state: null }, { seasonNumber: 2, episodeCount: 8, name: null, state: null }], backdropPath: null, tagline: null, rating: null, releaseDate: null, cast: [] };
      if (url === '/api/seerr/requests' && method === 'POST') return { id: 2, title: 'A Show', state: 'requested' };
      return {};
    });
    expect((await screen.findAllByText('Old Request')).length).toBeGreaterThan(0);
    expect(screen.getByText('Declined')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search movies and shows'), 'show');
    await userEvent.click(screen.getByRole('button', { name: 'Search movies and shows' }));
    expect(await screen.findByText('The Matrix')).toBeTruthy();
    expect(screen.getByText('Being added')).toBeTruthy();
    expect(screen.getByTitle('In the library')).toBeTruthy();

    // Its own page, with the seasons to choose from.
    await userEvent.click(screen.getByRole('button', { name: /A Show/ }));
    expect(await screen.findByRole('heading', { name: 'A Show' })).toBeTruthy();
    expect(await screen.findByText('Season 2 · 8 episodes')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Season 2 · 8 episodes'));
    await userEvent.click(screen.getByRole('button', { name: 'Request 1 season(s)' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request' }));
    await vi.waitFor(() => expect(calls.find((c) => c.call === 'POST /api/seerr/requests')?.body).toEqual({ mediaType: 'tv', tmdbId: 1399, seasons: [2] }));
  });

  it('says when Seerr is not set up', async () => {
    setup(<RequestsPage />, (_m, url) => (url === '/api/seerr' ? { enabled: false } : {}));
    expect(await screen.findByText('Not connected.')).toBeTruthy();
  });

  it('lets an administrator connect Seerr without ever showing the key again', async () => {
    const calls = setup(<SeerrSettings />, (method) => (method === 'PUT' ? { url: 'http://seerr.local:5055', hasKey: true, version: '3.0.0' } : { url: '', hasKey: false }));
    expect(await screen.findByText('Not connected.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Seerr address'), 'http://seerr.local:5055');
    await userEvent.type(screen.getByLabelText('API key (Seerr: Settings → General)'), 'seerr-api-key-123456');
    await userEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(await screen.findByText('Connected to Seerr 3.0.0 (http://seerr.local:5055).')).toBeTruthy();
    expect(calls.find((c) => c.call === 'PUT /api/admin/seerr')?.body).toEqual({ url: 'http://seerr.local:5055', apiKey: 'seerr-api-key-123456' });
    expect((screen.getByLabelText('API key (Seerr: Settings → General)') as HTMLInputElement).value).toBe('');
  });

  it('lets an administrator cancel anyone’s request, after asking', async () => {
    role = 'admin';
    const calls = setup(<RequestsPage />, (method, url) => {
      if (url === '/api/seerr') return { enabled: true };
      if (url === '/api/seerr/requests') return [];
      if (url === '/api/admin/seerr/requests') return [{ id: 7, mediaType: 'movie', tmdbId: 603, title: 'The Matrix', posterPath: null, state: 'approved', createdAt: 0, user: 'bram' }];
      if (method === 'DELETE') return { ok: true, inSeerr: true };
      return {};
    });
    expect(await screen.findByText('All requests')).toBeTruthy();
    expect(screen.getByText(/bram/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request for The Matrix' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/requested by bram/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    expect(calls.some((c) => c.call === 'DELETE /api/admin/seerr/requests/7')).toBe(true);
  });

  it('shows no one else’s requests to others', async () => {
    const calls = setup(<RequestsPage />, (_method, url) => (url === '/api/seerr' ? { enabled: true } : []));
    expect(await screen.findByText('Your requests')).toBeTruthy();
    expect(screen.queryByText('All requests')).toBeNull();
    expect(calls.some((c) => c.call.includes('/api/admin/'))).toBe(false);
  });
});
