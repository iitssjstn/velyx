import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'justin', role: 'admin' }, refetchServer: () => undefined }),
}));

import { AheadSettings, DetectionSettings, MaintenancePage, MetadataSettings, ScanSettings } from './SettingsPanels';

afterEach(() => vi.unstubAllGlobals());

const settings = {
  serverName: 'Home',
  tmdbLanguage: 'en-US',
  includeAdult: false,
  watchFolders: true,
  updateCheck: true,
  tmdb: { configured: true, source: 'settings', hint: '••••abcd', via: 'own', linked: false },
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
  aheadSeconds: 120,
  serverTime: '14:03',
  serverTimeZone: 'Europe/Amsterdam',
};

function setup(panel: ReactNode = <MaintenancePage />, current: unknown = settings) {
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
      if (url === '/api/admin/settings') return json(current);
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        {panel}
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

describe('each panel saves only its own settings', () => {
  it('converting ahead (on Playback): seconds typed in by the administrator', async () => {
    const saved = setup(<AheadSettings />);
    const field = (await screen.findByLabelText('Seconds ahead')) as HTMLInputElement;
    expect(field.value).toBe('120');
    expect(field.min).toBe('30');
    expect(field.max).toBe('3600');
    await userEvent.clear(field);
    await userEvent.type(field, '600');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ aheadSeconds: 600 });
  });

  it('scanning (on Libraries)', async () => {
    const saved = setup(<ScanSettings />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Scan automatically when files are added/ }));
    await userEvent.selectOptions(screen.getByLabelText('Scheduled scans'), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ watchFolders: false, scanOnStartup: false, deferScansWhilePlaying: true, scanIntervalMinutes: 60 });
  });

  it('has no TMDB key to fill in and no status while metadata comes through vidalune.com', async () => {
    setup(<MetadataSettings />, { ...settings, tmdb: { configured: false, source: 'none', hint: null, via: 'vidalune', linked: true } });
    expect(await screen.findByLabelText('Metadata language')).toBeTruthy();
    expect(screen.queryByLabelText(/TMDB API key/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Verify/ })).toBeNull();
    expect(screen.queryByText(/No metadata yet/)).toBeNull();
  });

  it('says to link the server when metadata does not come in', async () => {
    setup(<MetadataSettings />, { ...settings, tmdb: { configured: false, source: 'none', hint: null, via: null, linked: false } });
    expect(await screen.findByText(/No metadata yet: link this server to a Vidalune account/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Link this server' }).getAttribute('href')).toBe('/admin/cloud');
  });

  it('says vidalune.com is unavailable, without a link, when the server is linked', async () => {
    setup(<MetadataSettings />, { ...settings, tmdb: { configured: false, source: 'none', hint: null, via: null, linked: true } });
    expect(await screen.findByText(/not available through vidalune.com right now/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Link this server' })).toBeNull();
  });

  it('metadata language (on Metadata)', async () => {
    const saved = setup(<MetadataSettings />);
    const lang = await screen.findByLabelText('Metadata language');
    await userEvent.clear(lang);
    await userEvent.type(lang, 'nl-NL');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ tmdbLanguage: 'nl-NL', includeAdult: false });
  });

  it('detection (on Intros & credits)', async () => {
    const saved = setup(<DetectionSettings />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Detect intros/ }));
    expect((screen.getByRole('checkbox', { name: /Recognise end credits in the picture/ }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ segmentDetection: false, segmentVideo: true, sharedDetection: false });
  });
});
