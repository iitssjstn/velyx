import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Invite } from '../../lib/types';

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'justin', role: 'admin' } }),
  displayName: (u: { displayName?: string | null; username: string }) => u.displayName || u.username,
}));
const { UsersPage } = await import('./Users');

afterEach(() => vi.unstubAllGlobals());

const admin = { id: 1, username: 'justin', displayName: null, role: 'admin', disabled: false, createdAt: 0, lastLoginAt: null, libraryIds: null, avatarUrl: null };
const made: Invite = { id: 'inv-abc123', label: 'Lisa', libraryIds: [2], url: 'https://vidalune.com/invite#secret-token', createdAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, acceptedBy: null };

function setup(account: string | null, invites: Invite[] = []) {
  const calls: Array<{ call: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ call: `${method} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url === '/api/users') return json([admin]);
    if (url === '/api/admin/cloud') return json({ account });
    if (url === '/api/libraries') return json({ libraries: [{ id: 1, name: 'Films', type: 'movies' }, { id: 2, name: 'Series', type: 'shows' }] });
    if (url === '/api/admin/invites' && method === 'POST') return json(made);
    if (url === '/api/admin/invites') return json(invites);
    return json({ ok: true });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('inviting someone', () => {
  it('makes a link for the chosen libraries', async () => {
    const calls = setup('justin@example.com');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    await userEvent.type(screen.getByLabelText('Name (optional)'), 'Lisa');
    await userEvent.click(screen.getByLabelText('All libraries, including ones added later'));
    await userEvent.click(await screen.findByLabelText(/Films/));
    await userEvent.click(screen.getByRole('button', { name: 'Make link' }));
    expect((await screen.findByLabelText('Invitation link') as HTMLInputElement).value).toBe(made.url);
    expect(calls.find((c) => c.call === 'POST /api/admin/invites')?.body).toEqual({ label: 'Lisa', libraryIds: [2] });
  });

  it('asks to link the server first', async () => {
    setup(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(/Link this server to a Vidalune account first/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'To Vidalune account' }).getAttribute('href')).toBe('/admin/cloud');
  });

  it('lists open invitations, who accepted them, and withdraws one', async () => {
    const calls = setup('justin@example.com', [made, { ...made, id: 'inv-def456', label: null, libraryIds: null, acceptedBy: 'tom@example.com' }]);
    expect(await screen.findByText('Lisa')).toBeTruthy();
    expect(screen.getByText(/Accepted by tom@example.com/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Withdraw invitation' })[0]);
    expect(calls.map((c) => c.call)).toContain('DELETE /api/admin/invites/inv-abc123');
  });
});
