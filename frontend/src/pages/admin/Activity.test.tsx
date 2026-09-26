import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityPage, periodLabel } from './Activity';
import type { ActivityStats, HistoryEntry } from '../../lib/types';

afterEach(() => vi.unstubAllGlobals());

const stats: ActivityStats = {
  days: 30,
  from: 0,
  totals: { plays: 12, watchSec: 45_000, movies: 4, episodes: 8, users: 2 },
  modes: { direct: { plays: 9, watchSec: 30_000 }, remux: { plays: 3, watchSec: 15_000 }, audioConverted: 2 },
  granularity: 'day',
  timeline: [
    { period: '2026-09-24', watchSec: 0, plays: 0 },
    { period: '2026-09-25', watchSec: 7200, plays: 2 },
    { period: '2026-09-26', watchSec: 3600, plays: 1 },
  ],
  topMovies: [{ id: 3, title: 'Dune', subtitle: '2021', plays: 3, watchSec: 20_000 }],
  topShows: [{ id: 7, title: 'Severance', plays: 8, watchSec: 19_000 }],
  topUsers: [{ userId: 2, username: 'anna', plays: 8, watchSec: 30_000 }],
  clients: [{ device: 'Chrome on Windows', plays: 10, watchSec: 40_000 }],
};
const entry: HistoryEntry = {
  id: 1, userId: 2, username: 'anna', kind: 'episode', movieId: null, episodeId: 70, showId: 7, title: 'Severance', subtitle: 'S01E02 · Half Loop',
  mode: 'direct', audioConversion: null, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 1080, bitrate: 6_000_000,
  device: 'Safari on iPhone', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 600_000, watchedSec: 2900, positionSec: 3000, durationSec: 3300,
};

function setup() {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url === '/api/users') return new Response(JSON.stringify([{ id: 2, username: 'anna' }]), { status: 200 });
    if (url.startsWith('/api/admin/activity/history')) return new Response(JSON.stringify({ total: 1, items: [entry] }), { status: 200 });
    return new Response(JSON.stringify({ streams: [], stats: { ...stats, days: Number(/days=(\d+)/.exec(url)?.[1]) } }), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/activity']}>
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return urls;
}

describe('Activity page', () => {
  it('shows totals, modes, top lists and the history', async () => {
    setup();
    expect(await screen.findByText('Nobody is watching right now.')).toBeTruthy();
    expect(screen.getByText('Watch time').nextSibling?.textContent).toBe('13 h');
    expect(screen.getByText('Plays').nextSibling?.textContent).toBe('12');
    expect(screen.getByText('9 · 75%')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Dune/ }).getAttribute('href')).toBe('/movies/3');
    expect(screen.getByText('Chrome on Windows')).toBeTruthy();
    expect(await screen.findByText(/anna · Safari on iPhone · H\.264 · 1080p/)).toBeTruthy();
    expect(screen.getByText(/48 min watched · 91%/)).toBeTruthy();
  });

  it('switches the period and filters the history', async () => {
    const urls = setup();
    await screen.findByText('Nobody is watching right now.');
    await userEvent.click(screen.getByRole('button', { name: '12 months' }));
    await vi.waitFor(() => expect(urls).toContain('/api/admin/activity?days=365'));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Type' }), 'movie');
    await vi.waitFor(() => expect(urls.some((u) => u.includes('/api/admin/activity/history') && u.includes('kind=movie'))).toBe(true));
  });

  it('labels periods', () => {
    expect(periodLabel('2026-09', 'month')).toMatch(/2026/);
    expect(periodLabel('2026-09-21', 'week')).toMatch(/^Week of /);
  });
});
