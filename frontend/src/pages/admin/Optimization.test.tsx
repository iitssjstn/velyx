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

function setup(queue: unknown) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(JSON.stringify(method === 'GET' ? queue : {}), { status: 200, headers: { 'content-type': 'application/json' } });
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

  it('explains how to make the first copy when the queue is empty', async () => {
    setup({ paused: false, items: [] });
    expect(await screen.findByText('No optimized copies')).toBeTruthy();
  });
});
