import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The pages themselves are tested on their own; here only the navigation around them.
vi.mock('./Dashboard', () => ({ DashboardPage: () => <p>dashboard page</p> }));
vi.mock('./Logs', () => ({ LogsPage: () => <p>logs page</p> }));
vi.mock('./Backup', () => ({ BackupPage: () => <p>backup page</p> }));
vi.mock('./Integrations', () => ({ IntegrationsPage: () => <p>integrations page</p> }));
vi.mock('./SettingsPanels', () => ({ MaintenancePage: () => <p>maintenance page</p> }));

import AdminLayout from './AdminLayout';

afterEach(() => vi.unstubAllGlobals());

function setup(path: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ unread: 3 }), { status: 200 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('admin side navigation', () => {
  it('groups every admin section and marks the current one', async () => {
    setup('/admin/dashboard');
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    for (const group of ['System monitoring', 'Content & libraries', 'Integrations & maintenance', 'Users & permissions']) {
      expect(within(nav).getByRole('heading', { name: group })).toBeTruthy();
    }
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href')).sort()).toEqual(
      ['dashboard', 'activity', 'logs', 'audit', 'notifications', 'libraries', 'metadata', 'health', 'playback', 'optimization', 'cleanup', 'integrations', 'cloud', 'maintenance', 'server', 'backup', 'users']
        .map((s) => `/admin/${s}`)
        .sort(),
    );
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
    expect(await within(nav).findByLabelText('3 unread')).toBeTruthy();
    expect(screen.getByText('dashboard page')).toBeTruthy();
  });

  it('opens another section and closes the folded menu on small screens', async () => {
    setup('/admin/logs');
    const toggle = screen.getByRole('button', { name: 'Logs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(screen.getByRole('link', { name: 'Backup' }));
    expect(screen.getByText('backup page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Backup' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('sends the old Intros & credits address to Maintenance (corrections are made centrally now)', async () => {
    setup('/admin/intros');
    expect(await screen.findByText('maintenance page')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).queryByRole('link', { name: /Intros/ })).toBeNull();
  });

  it('sends the old Sonarr & Radarr address to Integrations', async () => {
    setup('/admin/arr');
    expect(await screen.findByText('integrations page')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('aria-current')).toBe('page');
  });
});
