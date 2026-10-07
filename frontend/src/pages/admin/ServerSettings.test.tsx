import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerSettingsPanel } from './ServerSettings';

vi.mock('../../lib/auth', () => ({ useAuth: () => ({ refetchServer: vi.fn() }) }));
vi.mock('./TranscodingSettings', () => ({ TranscodingSettings: () => null }));
vi.mock('./SeerrSettings', () => ({ SeerrSettings: () => null }));

afterEach(() => vi.unstubAllGlobals());

describe('server settings', () => {
  it('saves an optional public media URL', async () => {
    const settings = {
      serverName: 'Home', serverUrl: 'https://app.vidalune.com', tmdbLanguage: 'en-US', includeAdult: false,
      watchFolders: true, updateCheck: true, tmdb: { configured: false, source: 'none', hint: null },
      version: '0.19.34', mediaRoots: ['/media'], scanIntervalMinutes: 360, scanIntervalSource: 'environment',
      scanIntervalDefault: 360, scanOnStartup: false, deferScansWhilePlaying: true, segmentDetection: false,
      segmentVideo: false, sharedDetection: false,
    };
    let saved: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/online-subtitles') return new Response(JSON.stringify({ via: 'vidalune' }), { status: 200 });
      if (init?.method === 'PUT') {
        saved = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...settings, ...saved }), { status: 200 });
      }
      return new Response(JSON.stringify(settings), { status: 200 });
    }));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServerSettingsPanel />
      </QueryClientProvider>,
    );

    const serverUrl = await screen.findByLabelText('Server URL');
    await userEvent.clear(serverUrl);
    await userEvent.type(serverUrl, 'https://vidalune.justinitnetwork.nl');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved?.serverUrl).toBe('https://vidalune.justinitnetwork.nl'));
  });
});