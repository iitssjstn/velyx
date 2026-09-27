import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VidaluneAccount, type AccountCloud } from './VidaluneAccount';

afterEach(() => vi.unstubAllGlobals());

function setup(state: AccountCloud) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/account/cloud/link') return new Response(JSON.stringify({ code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/join#K7F3-Q9MA' }), { status: 200 });
    return new Response(JSON.stringify(url === '/api/account/cloud' ? state : { ok: true }), { status: 200 });
  }));
  const opened = vi.fn();
  vi.stubGlobal('open', opened);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VidaluneAccount />
    </QueryClientProvider>,
  );
  return { calls, opened };
}

describe('Vidalune account in Settings', () => {
  it('is not shown on a server that is not linked', async () => {
    const { calls } = setup({ available: false, email: null, appUrl: null });
    await vi.waitFor(() => expect(calls).toContain('GET /api/account/cloud'));
    expect(screen.queryByText('Vidalune account')).toBeNull();
  });

  it('opens vidalune.com with the code filled in', async () => {
    const { opened } = setup({ available: true, email: null, appUrl: 'https://app.vidalune.com' });
    await userEvent.click(await screen.findByRole('button', { name: 'Connect my Vidalune account' }));
    expect(opened).toHaveBeenCalledWith('https://vidalune.com/join#K7F3-Q9MA', '_blank', 'noopener');
    expect(await screen.findByText(/K7F3-Q9MA/)).toBeTruthy();
  });

  it('shows the connected account and disconnects it', async () => {
    const { calls } = setup({ available: true, email: 'lisa@example.com', appUrl: 'https://app.vidalune.com' });
    expect(await screen.findByText('Connected to lisa@example.com.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /My servers/ }).getAttribute('href')).toBe('https://app.vidalune.com/_vl/servers?choose');
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(calls).toContain('POST /api/account/cloud/unlink');
  });
});
