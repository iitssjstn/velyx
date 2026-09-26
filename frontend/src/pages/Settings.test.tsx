import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageSettings } from './Settings';

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
