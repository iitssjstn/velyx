import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupPage } from './Backup';
import type { BackupOverview } from '../../lib/types';

afterEach(() => vi.unstubAllGlobals());

const NAME = 'velyx-auto-2026-09-26T03-00-00.db';
const overview = (pending = false): BackupOverview => ({
  backups: [{ name: NAME, kind: 'auto', size: 2_400_000, createdAt: Date.UTC(2026, 8, 26, 3) }],
  schedule: { schedule: 'daily', hour: 3, keepDaily: 7, keepWeekly: 4, keepMonthly: 3 },
  nextDue: Date.UTC(2026, 8, 27, 3),
  pendingRestore: pending ? { source: NAME, requestedBy: 'justin', requestedAt: 1 } : null,
  folder: '/data/backups',
});

function setup() {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  let pending = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/verify')) return new Response(JSON.stringify({ ok: true, errors: [], info: { size: 1, migrations: 7, users: 2, movies: 812, shows: 64 } }), { status: 200 });
      if (url.endsWith('/restore')) pending = true;
      return new Response(JSON.stringify(overview(pending)), { status: 200 });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BackupPage />
    </QueryClientProvider>,
  );
  return calls;
}

describe('BackupPage', () => {
  it('verifies a backup and shows what it contains', async () => {
    const calls = setup();
    await screen.findByText(/velyx-auto-2026-09-26T03-00-00\.db/);
    expect(screen.getByText('Scheduled')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: `Verify ${NAME}` }));
    expect(await screen.findByText(/Verified: 2 users, 812 movies, 64 shows/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === `/api/admin/backups/${NAME}/verify`)).toBe(true);
  });

  it('stages a restore only after confirmation and shows the restart notice', async () => {
    const calls = setup();
    await screen.findByText(/velyx-auto-2026-09-26T03-00-00\.db/);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stage restore' }));
    expect(calls.find((c) => c.url.endsWith('/restore'))?.body).toEqual({ confirm: true });
    expect((await screen.findByRole('alert')).textContent).toContain('docker compose restart velyx');
  });

  it('saves the schedule', async () => {
    const calls = setup();
    await screen.findByText(/velyx-auto/);
    await userEvent.selectOptions(screen.getByLabelText('Schedule'), 'weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ schedule: 'weekly', hour: 3, keepDaily: 7 });
  });
});
