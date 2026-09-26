import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurrentDevice, LanguageSettings, SkipSettings, WatchHistory } from './Settings';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }), displayName: () => 'x' }));
afterEach(() => vi.unstubAllGlobals());

describe('LanguageSettings', () => {
  it('saves audio and subtitle preferences to the account', async () => {
    let state = { audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' };
    const puts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          puts.push(body);
          state = { ...state, ...body };
        }
        return new Response(JSON.stringify(state), { status: 200 });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageSettings />
      </QueryClientProvider>,
    );
    const mode = await screen.findByLabelText(/Show subtitles/);
    await vi.waitFor(() => expect((mode as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(mode, 'always');
    expect(await screen.findByText('Choose a language for this setting to work.')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText(/^Subtitle language/), 'nl');
    await userEvent.selectOptions(screen.getByLabelText(/Fallback subtitle language/), 'en');
    await userEvent.selectOptions(screen.getByLabelText(/Preferred audio language/), 'nl');
    expect(puts).toEqual([{ subtitleMode: 'always' }, { subtitleLanguage: 'nl' }, { subtitleFallback: 'en' }, { audioLanguage: 'nl' }]);
  });
});

describe('SkipSettings', () => {
  it('saves how intros and credits are skipped (a skip button by default)', async () => {
    let state = { audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember', skipIntro: 'ask', skipCredits: 'ask' };
    const puts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          puts.push(body);
          state = { ...state, ...body };
        }
        return new Response(JSON.stringify(state), { status: 200 });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SkipSettings />
      </QueryClientProvider>,
    );
    const intro = (await screen.findByLabelText(/Skip intros/)) as HTMLSelectElement;
    await vi.waitFor(() => expect(intro.disabled).toBe(false));
    expect(intro.value).toBe('ask');
    await userEvent.selectOptions(intro, 'always');
    await userEvent.selectOptions(screen.getByLabelText(/Skip credits/), 'never');
    expect(puts).toEqual([{ skipIntro: 'always' }, { skipCredits: 'never' }]);
  });
});

describe('WatchHistory', () => {
  it('lists your own viewings without your name on every row', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ total: 1, items: [{ id: 1, userId: 1, username: 'me', kind: 'movie', movieId: 3, episodeId: null, showId: null, title: 'Dune', subtitle: '2021', mode: 'remux', audioConversion: 'AAC stereo', container: 'mkv', videoCodec: 'hevc', audioCodec: 'dts', width: 3840, height: 2160, bitrate: null, device: 'Firefox on Linux', startedAt: Date.now() - 86_400_000, endedAt: Date.now() - 80_000_000, watchedSec: 5400, positionSec: 5400, durationSec: 9000 }] }), { status: 200 });
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><WatchHistory /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('link', { name: 'Dune' })).toBeTruthy();
    expect(screen.getByText(/^Firefox on Linux · HEVC · 4K/)).toBeTruthy();
    expect(screen.getByText('Remux · Audio → AAC stereo')).toBeTruthy();
    expect(urls[0]).toBe('/api/account/history?page=1&limit=30');
  });
});

describe('CurrentDevice', () => {
  it('names the device and shows what it plays, converts or cannot play', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            device: 'Chrome on Windows',
            family: 'chromium',
            confidence: 'reported',
            formats: [
              { key: 'h264', kind: 'video', label: 'H.264', support: 'yes', note: null },
              { key: 'hevc', kind: 'video', label: 'HEVC / H.265', support: 'no', note: 'Depends on hardware decoding support.' },
              { key: 'dts', kind: 'audio', label: 'DTS', support: 'converted', note: 'Velyx converts it to AAC while playing.' },
              { key: 'hdr', kind: 'display', label: 'HDR screen', support: 'depends', note: null },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CurrentDevice />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Chrome on Windows')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Plays' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Not supported' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Converted by Velyx' })).toBeTruthy();
    expect(screen.getByText('Depends on hardware decoding support.')).toBeTruthy();
    // The browser's own detection is sent along.
    expect(posted[0]).toHaveProperty('videoCodecs');
  });
});
