import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'justin', role: 'admin' }, refetchServer: () => undefined }),
}));

// Panels with their own settings: not part of this test.
vi.mock('./SeerrSettings', () => ({ SeerrSettings: () => null }));
vi.mock('./TranscodingSettings', () => ({ TranscodingSettings: () => null }));

import { ServerSettingsPanel } from './ServerSettings';

afterEach(() => vi.unstubAllGlobals());

const settings = {
  serverName: 'Home',
  tmdbLanguage: 'en-US',
  includeAdult: false,
  watchFolders: true,
  updateCheck: true,
  tmdb: { configured: true, source: 'settings', hint: '••••abcd' },
  version: '0.19.49',
  mediaRoots: ['/media'],
  scanIntervalMinutes: 360,
  scanIntervalSource: 'environment',
  scanIntervalDefault: 360,
  scanOnStartup: false,
  deferScansWhilePlaying: true,
  segmentDetection: true,
  segmentVideo: true,
  sharedDetection: false,
  subtitlePrefetch: true,
  subtitlePrefetchStatus: { enabled: true, pending: 12, running: false, waitingFor: 'quiet' },
  maintenanceStart: '02:00',
  maintenanceEnd: '06:00',
  maintenanceOutside: true,
  serverTime: '14:03',
  serverTimeZone: 'Europe/Amsterdam',
};

function setup() {
  const saved: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (url === '/api/admin/settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        saved.push(body);
        return json({ ...settings, ...body });
      }
      if (url === '/api/admin/settings') return json(settings);
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ServerSettingsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return saved;
}

describe('preparing subtitles ahead of time', () => {
  it('shows how many files are still to do and saves turning it off', async () => {
    const saved = setup();
    const box = (await screen.findByRole('checkbox', { name: /Prepare files for playback ahead of time/ })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText('12 files still to do.')).toBeTruthy();
    await userEvent.click(box);
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ subtitlePrefetch: false });
  });

  it('saves the maintenance window and whether to work outside it, and shows the server time', async () => {
    const saved = setup();
    const from = (await screen.findByLabelText('From')) as HTMLInputElement;
    expect(from.value).toBe('02:00');
    expect(screen.getByText(/It is 14:03 on the server \(Europe\/Amsterdam\)/)).toBeTruthy();
    fireEvent.change(from, { target: { value: '23:00' } });
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '05:00' } });
    await userEvent.click(screen.getByRole('checkbox', { name: /Also work outside the window/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ maintenanceStart: '23:00', maintenanceEnd: '05:00', maintenanceOutside: false });
  });
});
