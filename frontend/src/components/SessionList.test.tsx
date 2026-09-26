import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionList } from './SessionList';

afterEach(() => vi.unstubAllGlobals());

const SESSIONS = [
  { id: 'a'.repeat(20), createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now(), expiresAt: 0, userAgent: 'x', device: 'Firefox on Linux', ip: '192.168.2.10', current: true },
  { id: 'b'.repeat(20), createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now() - 3_600_000, expiresAt: 0, userAgent: 'y', device: 'Safari on iOS', ip: '203.0.113.9', current: false },
];

function setup(userId?: number) {
  const calls: Array<{ method: string; url: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(SESSIONS), { status: 200 });
      return new Response(JSON.stringify({ ok: true, revoked: 1 }), { status: 200 });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionList userId={userId} />
    </QueryClientProvider>,
  );
  return calls;
}

describe('SessionList', () => {
  it('shows devices and revokes one session', async () => {
    const calls = setup();
    expect(await screen.findByText('Safari on iOS')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
    // The current device cannot be revoked from here; only the other one has a button.
    const buttons = screen.getAllByRole('button', { name: 'Revoke' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(calls).toContainEqual({ method: 'DELETE', url: `/api/account/sessions/${'b'.repeat(20)}` });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out all other devices' }));
    expect(calls).toContainEqual({ method: 'POST', url: '/api/account/sessions/revoke-others' });
  });

  it('uses the admin endpoints for another user', async () => {
    const calls = setup(7);
    await screen.findByText('Safari on iOS');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke all sessions' }));
    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/users/7/sessions' });
  });
});
