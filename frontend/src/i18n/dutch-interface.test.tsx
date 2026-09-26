import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setLanguage } from './index';
import { Layout } from '../components/Layout';
import { UpNext } from '../components/UpNext';
import { EmptyState, ErrorState } from '../components/States';
import { ApiError } from '../lib/api';
import { InterfaceLanguage, SkipSettings, LanguageSettings } from '../pages/Settings';
import { CleanupPage, type CleanupList } from '../pages/admin/Cleanup';
import { HealthPage, type HealthSummary } from '../pages/admin/Health';
import { ActivityPage } from '../pages/admin/Activity';
import { SegmentsPage, type SegmentOverview } from '../pages/admin/Segments';
import type { ActivityStats } from '../lib/types';

const setUser = vi.fn();
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin', username: 'justin', displayName: null, avatarUrl: null, language: 'nl' }, setUser, logout: vi.fn() }),
  useOptionalAuth: () => ({ user: { id: 1, role: 'admin' } }),
  displayName: () => 'justin',
}));

beforeEach(async () => {
  await setLanguage('nl');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await setLanguage('en');
});

/** English interface words that must not show up in the Dutch interface (data such as titles aside). */
const ENGLISH = /\b(Settings|Movies|Watched|Unwatched|Delete|Cancel|Resume|Episodes?|Library|Libraries|Search|Loading|Previous|Next|Waiting|Errors?|Never|Users?|Show|Keep|Rules|Analyse|Playback|Subtitles|Nothing|Always|Remember|Skip|Sign out|Home|Collections|Favorites|Watchlist)\b/;

function expectNoEnglish(container: HTMLElement) {
  const text = container.textContent ?? '';
  const labels = [...container.querySelectorAll('[aria-label],[title],[placeholder]')].map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('placeholder') ?? ''}`).join(' ');
  expect(ENGLISH.exec(text)?.[0] ?? null).toBeNull();
  expect(ENGLISH.exec(labels)?.[0] ?? null).toBeNull();
}

function mount(ui: ReactNode, route = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(handler(url, init)), { status: 200 })));
}

describe('Dutch interface', () => {
  it('navigation', () => {
    const { container } = mount(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<p>…</p>} />
        </Route>
      </Routes>,
    );
    for (const label of ['Start', 'Films', 'Series', 'Collecties', 'Kijklijst', 'Favorieten', 'Instellingen', 'Beheer']) expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Uitloggen' })).toBeTruthy();
    expectNoEnglish(container);
  });

  it('player: the next-episode card', () => {
    const { container } = render(
      <UpNext next={{ id: 9, seasonNumber: 1, episodeNumber: 9, title: 'La Catedral', stillPath: null, overview: null, runtime: 52, durationSec: null }} countdown={5} countdownTotal={10} credits ended={false} onPlay={() => undefined} onStay={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Aftiteling kijken' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volgende aflevering, start over 5 seconden' })).toBeTruthy();
    expect(container.textContent).toContain('Volgende aflevering · S01E09 · 52 min');
    expectNoEnglish(container);
  });

  it('errors and empty states', () => {
    const { container } = render(
      <>
        <ErrorState error={new ApiError('Film niet gevonden.', 404)} onRetry={() => undefined} />
        <EmptyState title="—" />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Niet gevonden' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Opnieuw proberen' })).toBeTruthy();
    expectNoEnglish(container);
  });

  it('settings: interface language, audio and subtitle languages, skipping', async () => {
    const prefs = { audioLanguage: 'en', subtitleLanguage: 'nl', subtitleFallback: '', subtitleMode: 'always', skipIntro: 'ask', skipCredits: 'always' };
    stubFetch(() => prefs);
    const { container } = mount(
      <>
        <InterfaceLanguage />
        <LanguageSettings />
        <SkipSettings />
      </>,
    );
    expect(await screen.findByRole('heading', { name: 'Talen voor audio en ondertiteling' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Taal' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Nederlands' })).toHaveProperty('checked', true);
    // Audio and subtitle languages are named in Dutch.
    expect((await screen.findAllByRole('option', { name: 'Engels' })).length).toBe(3);
    expect(screen.getByRole('heading', { name: "Intro's en aftiteling" })).toBeTruthy();
    expectNoEnglish(container);
  });

  it('clean-up', async () => {
    const rules = { unwatched: { enabled: true, days: 365 }, stale: { enabled: false, days: 730 }, large: { enabled: true, gb: 50 }, duplicates: { enabled: true }, missingInfo: { enabled: true } };
    const list: CleanupList = {
      summary: { rules, counts: { unwatched: { files: 1, bytes: 4e9 }, stale: { files: 0, bytes: 0 }, large: { files: 0, bytes: 0 }, duplicates: { files: 0, bytes: 0 }, missingInfo: { files: 0, bytes: 0 } }, total: { files: 1, bytes: 4e9 }, kept: 1 },
      deletion: { enabled: false, libraries: [{ id: 1, name: 'Films', path: '/media/films', writable: false }, { id: 2, name: 'Tv', path: '/media/tv', writable: true }] },
      total: 1,
      bytes: 4e9,
      items: [{ fileId: 1, libraryId: 1, library: 'Films', kind: 'movie', title: 'Alien', subtitle: '1979', href: '/movies/1', path: '/media/films/Alien.mkv', size: 4e9, width: 1920, height: 1080, addedAt: Date.now() - 4e10, watchedBy: 0, started: false, lastWatchedAt: null, reasons: [{ rule: 'unwatched', text: 'Nooit bekeken, 13 maanden geleden toegevoegd' }] }],
    };
    stubFetch(() => list);
    const { container } = mount(<CleanupPage />, '/admin/cleanup');
    expect(await screen.findByText(/Bestanden verwijderen staat uit/)).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alien 1979 selecteren' }));
    expect(screen.getByRole('region', { name: 'Geselecteerde bestanden' }).textContent).toMatch(/1 geselecteerd/);
    expectNoEnglish(container);
  });

  it('library health', async () => {
    const summary: HealthSummary = {
      categories: [
        { key: 'direct', label: 'Direct Play', group: 'playback', unit: 'files', description: 'Speelt ongewijzigd af.', count: 10 },
        { key: 'not-analyzed', label: 'Niet volledig geanalyseerd', group: 'library', unit: 'files', description: '…', count: 2 },
      ],
      files: 12,
      tmdbConfigured: true,
      analysis: { running: false, done: 0, total: 0, failed: 0 },
    };
    stubFetch((url) => (url === '/api/libraries' ? { libraries: [{ id: 1, name: 'Films' }] } : summary));
    const { container } = mount(<HealthPage />, '/admin/health');
    expect(await screen.findByRole('heading', { name: 'Afspelen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nu analyseren' })).toBeTruthy();
    expectNoEnglish(container);
  });

  it('activity and statistics', async () => {
    const stats: ActivityStats = {
      days: 30,
      from: 0,
      totals: { plays: 12, watchSec: 45_000, movies: 4, episodes: 8, users: 2 },
      modes: { direct: { plays: 9, watchSec: 30_000 }, remux: { plays: 3, watchSec: 15_000 }, audioConverted: 2 },
      granularity: 'day',
      timeline: [{ period: '2026-09-26', watchSec: 3600, plays: 1 }],
      topMovies: [],
      topShows: [],
      topUsers: [{ userId: 2, username: 'anna', plays: 8, watchSec: 30_000 }],
      clients: [{ device: 'Chrome on Windows', plays: 10, watchSec: 40_000 }],
    };
    stubFetch((url) => (url === '/api/users' ? [] : url.startsWith('/api/admin/activity/history') ? { total: 0, items: [] } : { streams: [], stats }));
    const { container } = mount(<ActivityPage />, '/admin/activity');
    expect(await screen.findByRole('heading', { name: 'Kijktijd per dag' })).toBeTruthy();
    expect(screen.getByText('Chrome op Windows')).toBeTruthy();
    expectNoEnglish(container);
  });

  it('intros and credits', async () => {
    const overview: SegmentOverview = {
      status: { enabled: true, state: 'waiting', waitingFor: 'playback', running: null, queuedSeasons: 0, counts: { episodes: 20, analyzed: 17, intros: 15, credits: 16, pending: 2, errors: 1, manual: 1, lowConfidence: 2 } },
      shows: [{ id: 3, title: 'Severance', episodes: 20, analyzed: 17, intros: 15, credits: 16, errors: 1, manual: 1, low: 2 }],
      errors: [{ episodeId: 44, error: 'The file has no readable audio', detectedAt: Date.now() - 60_000, showId: 3, showTitle: 'Severance', seasonNumber: 2, episodeNumber: 4 }],
    };
    stubFetch(() => overview);
    const { container } = mount(<SegmentsPage />, '/admin/intros');
    expect(await screen.findByText(/Wacht: er kijkt iemand/)).toBeTruthy();
    expect(screen.getByText('Het bestand heeft geen leesbare audio')).toBeTruthy();
    expectNoEnglish(container);
  });
});

describe('choosing the interface language', () => {
  it('saves it to the account and switches the page at once', async () => {
    await setLanguage('en');
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ user: { id: 1, username: 'justin', role: 'admin', language: 'nl' } }), { status: 200 });
    }));
    mount(<InterfaceLanguage />);
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Nederlands' }));
    expect(await screen.findByRole('heading', { name: 'Taal' })).toBeTruthy();
    expect(calls).toEqual([{ url: '/api/account/language', body: { language: 'nl' } }]);
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ language: 'nl' }));
  });
});
