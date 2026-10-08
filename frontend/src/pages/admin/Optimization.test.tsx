import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OptimizationPage } from './Optimization';

afterEach(() => vi.unstubAllGlobals());

const base = { fileId: 7, outputSize: null, updatedAt: 1, movieId: null, showId: null, title: null, year: null, season: null, episode: null, episodeTitle: null, position: null };
const running = { ...base, id: 1, profile: 'compat-720p', status: 'processing', progress: 42, movieId: 5, title: 'Heat', year: 1995 };
const waiting = { ...base, id: 2, fileId: 8, profile: 'compat-1080p', status: 'queued', progress: 0, position: 1, showId: 9, title: 'Severance', season: 1, episode: 2, episodeTitle: 'Half Loop' };
const failed = { ...base, id: 3, fileId: 9, profile: 'compat-720p', status: 'failed', progress: 0, movieId: 6, title: 'Alien', year: 1979, error: 'Not enough free space on the Vidalune data disk for this copy.' };

function setup(queue: unknown, answer?: (url: string, method: string) => unknown) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(JSON.stringify(answer?.(url, method) ?? (method === 'GET' ? queue : {})), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><OptimizationPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('OptimizationPage', () => {
  it('shows what is running, what waits and why something failed', async () => {
    setup({ paused: true, items: [running, waiting, failed] });
    expect(await screen.findByRole('link', { name: 'Heat' })).toHaveProperty('pathname', '/movies/5');
    expect(screen.getByRole('link', { name: 'Severance' })).toHaveProperty('pathname', '/shows/9');
    expect(screen.getByText('S01E02 · Half Loop')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('Place 1 in the queue')).toBeTruthy();
    expect(screen.getByText(/Not enough free space/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('On hold');
  });

  it('retries a failed copy with the same profile', async () => {
    const calls = setup({ paused: false, items: [failed] });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));
    expect(calls.some((call) => call.url === '/api/admin/media/9/optimizations' && call.method === 'POST' && call.body === '{"profile":"compat-720p"}')).toBe(true);
  });

  it('does not allow removing a copy that is being made, and asks before removing another', async () => {
    const calls = setup({ paused: false, items: [running, failed] });
    const user = userEvent.setup();
    expect((await screen.findByRole('button', { name: 'Remove copy: Heat' })).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove copy: Alien' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove copy' }));
    expect(calls.some((call) => call.url === '/api/admin/optimizations/3' && call.method === 'DELETE')).toBe(true);
  });

  it('offers creation controls even when the queue is empty', async () => {
    setup({ paused: false, items: [] });
    expect(await screen.findByText('No optimized copies')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search library' })).toBeTruthy();
  });

  it('optimizes a selected movie source in the admin page and refreshes the queue', async () => {
    const calls = setup({ paused: false, items: [] }, (url, method) => {
      if (url.startsWith('/api/search')) return { movies: [{ id: 5, title: 'Heat', year: 1995 }], shows: [], episodes: [] };
      if (url === '/api/movies/5') return { files: [{ id: 7, fileName: 'Heat.mkv', height: 2160, size: 1000 }, { id: 8, fileName: 'Heat-alt.mkv', height: 1080, size: 500 }] };
      if (url === '/api/admin/media/8/optimizations' && method === 'POST') return { variant: { id: 4, profile: 'compat-1080p', status: 'queued', progress: 0 } };
      if (url.includes('/media/') && url.endsWith('/optimizations')) return { variants: [] };
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search library' }), 'Heat');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Choose a title' }), 'movie:5');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Source file' }), '8');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Copy profile' }), 'compat-1080p');
    await user.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(calls.some((call) => call.url === '/api/admin/media/8/optimizations' && call.method === 'POST' && call.body === '{"profile":"compat-1080p"}')).toBe(true);
    expect(calls.filter((call) => call.url === '/api/admin/optimizations')).toHaveLength(2);
  });

  it('selects a show season and episode before optimizing its source', async () => {
    const calls = setup({ paused: false, items: [] }, (url, method) => {
      if (url.startsWith('/api/search')) return { movies: [], shows: [{ id: 9, title: 'Severance', year: 2022 }], episodes: [] };
      if (url === '/api/shows/9') return { seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }] };
      if (url === '/api/shows/9/seasons/1') return { episodes: [{ id: 21, seasonNumber: 1, episodeNumber: 1, title: 'First' }] };
      if (url === '/api/shows/9/seasons/2') return { episodes: [{ id: 22, seasonNumber: 2, episodeNumber: 1, title: 'Second' }] };
      if (url === '/api/episodes/21') return { files: [{ id: 71, fileName: 'S01E01.mkv', height: 1080, size: 1000 }] };
      if (url === '/api/episodes/22') return { files: [{ id: 72, fileName: 'S02E01.mkv', height: 1080, size: 1000 }] };
      if (url === '/api/admin/media/72/optimizations' && method === 'POST') return { variant: { id: 5, profile: 'compat-720p', status: 'queued', progress: 0 } };
      if (url.includes('/media/') && url.endsWith('/optimizations')) return { variants: [] };
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search library' }), 'Severance');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Choose a title' }), 'show:9');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Season' }), '2');
    expect(await screen.findByRole('option', { name: 'S02E01 · Second' })).toBeTruthy();
    await screen.findByRole('option', { name: /S02E01.mkv/ });
    await user.click(await screen.findByRole('button', { name: 'Optimize' }));
    expect(calls.some((call) => call.url === '/api/admin/media/72/optimizations' && call.method === 'POST')).toBe(true);
  });
});
