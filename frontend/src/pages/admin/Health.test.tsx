import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthPage, type HealthCategory, type HealthItem, type HealthSummary } from './Health';

afterEach(() => vi.unstubAllGlobals());

const cat = (key: string, label: string, group: HealthCategory['group'], count: number): HealthCategory => ({ key, label, group, unit: 'files', description: `${label} description`, count });

const summary: HealthSummary = {
  categories: [
    cat('direct', 'Direct Play', 'playback', 1842),
    cat('remux', 'Remux required', 'playback', 327),
    cat('browser-dependent', 'Depends on device', 'playback', 12),
    cat('unsupported', 'Unsupported', 'playback', 41),
    cat('hevc', 'HEVC', 'formats', 139),
    { ...cat('missing-artwork', 'Missing artwork', 'library', 12), unit: 'items' },
    cat('scan-errors', 'Scan errors', 'library', 3),
    cat('not-analyzed', 'Not fully analysed', 'library', 0),
  ],
  files: 2222,
  tmdbConfigured: true,
  analysis: { running: false, done: 0, total: 0, failed: 0 },
};

const items = (page: number): HealthItem[] =>
  Array.from({ length: page === 1 ? 50 : 1 }, (_, i) => ({
    kind: 'movie',
    id: page * 100 + i,
    title: page === 1 && i === 0 ? 'Old Divx' : `Movie ${page}-${i}`,
    subtitle: '2001',
    href: `/movies/${page * 100 + i}`,
    library: 'Films',
    file: { id: i, path: 'Old Divx (2001)/old.avi', size: 734003200, summary: 'MPEG-4 Part 2 (DivX/Xvid) · 480p · MP3 stereo · AVI' },
    reasons: ['MPEG-4 Part 2 (DivX/Xvid) video cannot be decoded by web browsers.', 'Velyx does not transcode video.'],
  }));

function setup(initial = '/admin/health') {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/libraries') return new Response(JSON.stringify({ libraries: [{ id: 1, name: 'Films' }, { id: 2, name: 'Series' }] }), { status: 200 });
      const m = /^\/api\/admin\/health\/([^?]+)\?page=(\d+)/.exec(url);
      if (m) return new Response(JSON.stringify({ total: 51, items: items(Number(m[2])) }), { status: 200 });
      return new Response(JSON.stringify(summary), { status: 200 });
    }),
  );
  render(
    <MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HealthPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return calls;
}

describe('HealthPage', () => {
  it('shows counts per category, grouped', async () => {
    setup();
    const unsupported = await screen.findByRole('button', { name: /Unsupported/ });
    expect(unsupported.textContent).toContain('41');
    expect(screen.getByRole('button', { name: /Direct Play/ }).textContent).toContain('1,842');
    expect(screen.getByRole('heading', { name: 'Playback' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
    expect(screen.getByText(/nothing is rescanned/)).toBeTruthy();
  });

  it('lists the affected media with reasons, page by page', async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Unsupported/ }));
    expect(await screen.findByRole('link', { name: 'Old Divx' })).toHaveProperty('pathname', '/movies/100');
    expect(screen.getAllByText('Velyx does not transcode video.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Old Divx \(2001\)\/old\.avi/).length).toBeGreaterThan(0);
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Movie 2-0')).toBeTruthy();
    expect(calls).toContain('/api/admin/health/unsupported?page=2&limit=50');
  });

  it('filters by library', async () => {
    const calls = setup('/admin/health?library=2&category=scan-errors');
    await screen.findByRole('heading', { name: 'Scan errors' });
    expect(calls).toContain('/api/admin/health?libraryId=2');
    expect(calls).toContain('/api/admin/health/scan-errors?page=1&limit=50&libraryId=2');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('2');
  });
});
