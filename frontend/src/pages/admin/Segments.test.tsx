import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SegmentsPage, type SegmentOverview } from './Segments';

afterEach(() => vi.unstubAllGlobals());

const overview: SegmentOverview = {
  status: { enabled: true, state: 'waiting', waitingFor: 'playback', running: null, queuedSeasons: 1, counts: { episodes: 20, analyzed: 17, intros: 15, credits: 16, pending: 2, errors: 1, manual: 1, lowConfidence: 2 } },
  shows: [{ id: 3, title: 'Severance', episodes: 20, analyzed: 17, intros: 15, credits: 16, errors: 1, manual: 1, low: 2 }],
  errors: [{ episodeId: 44, error: 'Invalid data found when processing input', detectedAt: Date.now() - 60_000, showId: 3, showTitle: 'Severance', seasonNumber: 2, episodeNumber: 4 }],
};

const show = {
  show: { id: 3, title: 'Severance' },
  seasons: [
    {
      seasonNumber: 1,
      episodes: [
        { id: 10, episodeNumber: 1, title: 'Good News About Hell', duration: 3420, eligible: true, segments: { status: 'analyzed', error: null, intro: { start: 212, end: 272, confidence: 'high' }, credits: { start: 3300, end: 3420, confidence: 'medium' }, postCredits: null, manual: false, detectedAt: 1 } },
        { id: 11, episodeNumber: 2, title: 'Half Loop', duration: 3300, eligible: true, segments: { status: 'analyzed', error: null, intro: { start: 30, end: 90, confidence: null }, credits: null, postCredits: { start: 3250, end: 3300, confidence: null }, manual: true, detectedAt: 1 } },
        { id: 12, episodeNumber: 3, title: 'In Perpetuity', duration: 3000, eligible: true, segments: null },
      ],
    },
  ],
};

function setup(initial = '/admin/intros') {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/admin/segments') return new Response(JSON.stringify(overview), { status: 200 });
      if (url === '/api/admin/segments/shows/3') return new Response(JSON.stringify(show), { status: 200 });
      if (url === '/api/admin/segments/analyze') return new Response(JSON.stringify({ queued: 3 }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <SegmentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('Intros & credits admin page', () => {
  it('shows the status, the counts, the shows and the errors', async () => {
    setup();
    expect(await screen.findByText(/Waiting: someone is watching/)).toBeTruthy();
    expect(screen.getByText('Intros found').nextSibling?.textContent).toBe('15');
    expect(screen.getByText('Errors', { selector: 'p' }).nextSibling?.textContent).toBe('1');
    expect(screen.getByRole('button', { name: 'Severance' })).toBeTruthy();
    expect(screen.getByText('Invalid data found when processing input')).toBeTruthy();
    expect(screen.getByText(/Severance · S02E04/)).toBeTruthy();
  });

  it('lists results per episode and re-analyses a season', async () => {
    const calls = setup('/admin/intros?show=3');
    expect(await screen.findByText('Good News About Hell')).toBeTruthy();
    expect(screen.getByText('3:32–4:32')).toBeTruthy();
    expect(screen.getByText('medium')).toBeTruthy();
    expect(screen.getByText('manual')).toBeTruthy();
    expect(screen.getByText('Not analysed yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Analyse season again' }));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/admin/segments/analyze', body: { scope: 'season', showId: 3, seasonNumber: 1 } });
    // A manual correction can be removed; automatic results can be analysed again.
    await userEvent.click(screen.getByRole('button', { name: 'Remove correction of episode 2' }));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/admin/segments/episodes/11');
  });

  it('saves corrected times and checks them first', async () => {
    const calls = setup('/admin/intros?show=3');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit episode 1' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Intro start') as HTMLInputElement).value).toBe('3:32');
    await userEvent.clear(within(dialog).getByLabelText('Intro end'));
    await userEvent.type(within(dialog).getByLabelText('Intro end'), '3:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Each end must be after its start.')).toBeTruthy();
    await userEvent.clear(within(dialog).getByLabelText('Intro end'));
    await userEvent.type(within(dialog).getByLabelText('Intro end'), '4:40');
    await userEvent.clear(within(dialog).getByLabelText('Credits start'));
    await userEvent.clear(within(dialog).getByLabelText('Credits end'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/admin/segments/episodes/10', body: { intro: { start: 212, end: 280 }, credits: null, postCredits: null } });
  });
});
