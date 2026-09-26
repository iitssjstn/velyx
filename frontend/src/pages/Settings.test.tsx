import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurrentDevice, LanguageSettings, SkipSettings } from './Settings';

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
