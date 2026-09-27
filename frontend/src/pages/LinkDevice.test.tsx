import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkDevicePage } from './LinkDevice';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 2, role: 'user', username: 'lotte', displayName: 'Lotte' } }), displayName: (u: { displayName: string }) => u.displayName }));
afterEach(() => vi.unstubAllGlobals());

function setup(url = '/link', respond?: (url: string, method: string) => Response | undefined) {
  const calls: Array<{ method: string; url: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: u });
    const custom = respond?.(u, method);
    if (custom) return custom;
    if (method === 'GET') return new Response(JSON.stringify({ code: 'ABC-DEF', deviceName: 'Pixel 8', expiresAt: Date.now() + 60_000 }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, deviceName: 'Pixel 8' }), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <LinkDevicePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('connecting the Vidalune app', () => {
  it('checks the code, asks to confirm the device, then connects it', async () => {
    const calls = setup();
    const input = screen.getByLabelText('Code');
    await userEvent.type(input, 'abc-def');
    expect((input as HTMLInputElement).value).toBe('ABC-DEF');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Sign in Pixel 8 as Lotte?')).toBeTruthy();
    // Nothing is connected before confirming.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Pixel 8 is now signed in as Lotte.')).toBeTruthy();
    expect(calls).toContainEqual({ method: 'POST', url: '/api/auth/pair/ABC-DEF/approve' });
  });

  it('takes the code from the link and explains a wrong one', async () => {
    setup('/link?code=XYZ-234', (u) => (u.includes('XYZ-234') ? new Response(JSON.stringify({ error: 'This code is not valid (any more).' }), { status: 404 }) : undefined));
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('XYZ-234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This code is not valid (any more).');
  });

  it('lets the user go back and use another code', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Code'), 'ABCDEF');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use another code' }));
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('');
  });
});
