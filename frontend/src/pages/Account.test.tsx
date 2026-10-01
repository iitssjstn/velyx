import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let role: 'admin' | 'user' = 'user';
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role, username: 'justin', displayName: 'Justin' } }), displayName: () => 'Justin' }));
// Nothing needs to load for these tests.
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: { get: () => new Promise(() => undefined), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));
const { OldSettingsRedirect, SettingsPage } = await import('./Settings');

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/account/*" element={<><SettingsPage /><Where /></>} />
          <Route path="/settings/*" element={<OldSettingsRedirect />} />
          <Route path="/admin/*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('the Account page', () => {
  it('has the account tabs; administrators find the server and libraries under Admin', () => {
    role = 'admin';
    renderAt('/account/playback');
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Profile', 'Playback', 'History']);
    cleanup();
    role = 'user';
    renderAt('/account/playback');
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Profile', 'Playback', 'History', 'Server']);
  });

  it('sends the old Settings addresses to where things are now', () => {
    for (const [r, from, to] of [
      ['user', '/settings/playback', '/account/playback'],
      ['user', '/settings/account', '/account/account'],
      ['admin', '/settings/server', '/admin/server'],
      ['admin', '/settings/libraries', '/admin/libraries'],
      ['user', '/settings/server', '/account/server'],
    ] as const) {
      role = r;
      renderAt(from);
      expect(screen.getByTestId('where').textContent).toBe(to);
      cleanup();
    }
  });
});
