import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnlineSubtitlesSettings } from './ServerSettings';

afterEach(() => vi.unstubAllGlobals());

function setup(initial: object, reply: (body: Record<string, string>) => [number, object]) {
  const puts: Record<string, string>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      const [status, data] = reply(body);
      return new Response(JSON.stringify(data), { status });
    }
    return new Response(JSON.stringify(initial), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnlineSubtitlesSettings />
    </QueryClientProvider>,
  );
  return puts;
}

describe('OpenSubtitles settings', () => {
  it('is off until a key is saved, and never shows the key', async () => {
    const puts = setup({ configured: false, hint: null, username: null, hasPassword: false }, () => [200, { configured: true, hint: '••••1234', username: null, hasPassword: false }]);
    expect(await screen.findByText('Off')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Verify & save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('OpenSubtitles API key'), 'abcd1234');
    await userEvent.click(save);
    await waitFor(() => expect(puts).toEqual([{ apiKey: 'abcd1234' }]));
    expect(await screen.findByText('On, key ••••1234')).toBeTruthy();
    expect((screen.getByLabelText('OpenSubtitles API key') as HTMLInputElement).value).toBe('');
  });

  it('adds an account and can be turned off', async () => {
    const puts = setup({ configured: true, hint: '••••1234', username: null, hasPassword: false }, (b) => [200, b.apiKey === '' ? { configured: false, hint: null, username: null, hasPassword: false } : { configured: true, hint: '••••1234', username: 'anna', hasPassword: true }]);
    await userEvent.type(await screen.findByLabelText('OpenSubtitles username'), 'anna');
    await userEvent.type(screen.getByLabelText('OpenSubtitles password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & save' }));
    expect(await screen.findByText('On, key ••••1234, signed in as anna')).toBeTruthy();
    expect(puts[0]).toEqual({ username: 'anna', password: 'secret' });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Off')).toBeTruthy();
    expect(puts[1]).toEqual({ apiKey: '' });
  });
});
