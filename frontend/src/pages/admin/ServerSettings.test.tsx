import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'justin', role: 'admin' }, refetchServer: () => undefined }),
}));

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

describe('the Server page', () => {
  it('shows the server itself and saves only its name and the update check', async () => {
    const saved = setup();
    const name = await screen.findByLabelText('Server name');
    expect(screen.getByText('Vidalune 0.19.49')).toBeTruthy();
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Scan automatically when files are added/ })).toBeNull();
    await userEvent.clear(name);
    await userEvent.type(name, 'Living room');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ serverName: 'Living room', updateCheck: true });
  });
});
