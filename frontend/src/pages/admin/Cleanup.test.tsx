import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CleanupPage, watchStatus, type CleanupCandidate, type CleanupList } from './Cleanup';

afterEach(() => vi.unstubAllGlobals());

const GB = 1024 ** 3;
const cand = (id: number, title: string, size: number, reasons: CleanupCandidate['reasons']): CleanupCandidate => ({
  fileId: id, libraryId: 1, library: 'Films', kind: 'movie', title, subtitle: '1979', href: `/movies/${id}`, path: `/media/films/${title}/${title}.mkv`,
  size, width: 1920, height: 1080, addedAt: Date.now() - 400 * 86_400_000, watchedBy: 0, started: false, lastWatchedAt: null, reasons,
});
const rules = { unwatched: { enabled: true, days: 365 }, stale: { enabled: false, days: 730 }, large: { enabled: true, gb: 50 }, duplicates: { enabled: true }, missingInfo: { enabled: true } };

function setup(deletion: boolean) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const list: CleanupList = {
    summary: { rules, counts: { unwatched: { files: 1, bytes: 4 * GB }, stale: { files: 0, bytes: 0 }, large: { files: 1, bytes: 60 * GB }, duplicates: { files: 0, bytes: 0 }, missingInfo: { files: 0, bytes: 0 } }, total: { files: 2, bytes: 64 * GB }, kept: 0 },
    deletion: { enabled: deletion, libraries: [{ id: 1, name: 'Films', path: '/media/films', writable: true }] },
    total: 2,
    bytes: 64 * GB,
    items: [cand(1, 'Dune', 60 * GB, [{ rule: 'large', text: 'Larger than 50 GB' }]), cand(2, 'Alien', 4 * GB, [{ rule: 'unwatched', text: 'Never watched, added 13 months ago' }])],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/admin/cleanup/delete') return new Response(JSON.stringify({ results: [{ fileId: 2, path: '/media/films/Alien/Alien.mkv', size: 4 * GB, ok: true, error: null }] }), { status: 200 });
    if (url === '/api/admin/cleanup/keep') return new Response(JSON.stringify({ kept: 1 }), { status: 200 });
    return new Response(JSON.stringify(list), { status: 200 });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/cleanup']}>
        <CleanupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('Clean-up page', () => {
  it('shows suggestions with size, path, watch status and reasons; deleting is off by default', async () => {
    setup(false);
    expect(await screen.findByText('Larger than 50 GB')).toBeTruthy();
    expect(screen.getByText('/media/films/Alien/Alien.mkv')).toBeTruthy();
    expect(screen.getAllByText(/1080p · Never watched · added/)).toHaveLength(2);
    expect(screen.getByText(/Deleting files is off/)).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Alien 1979' }));
    const bar = screen.getByRole('region', { name: 'Selected files' });
    expect((within(bar).getByRole('button', { name: /Delete/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps selected files', async () => {
    const calls = setup(false);
    await screen.findByText('Larger than 50 GB');
    await userEvent.click(screen.getByLabelText('Select all on this page'));
    const bar = screen.getByRole('region', { name: 'Selected files' });
    expect(bar.textContent).toMatch(/2 selected · 64/);
    await userEvent.click(within(bar).getByRole('button', { name: 'Keep' }));
    expect(calls.find((c) => c.url === '/api/admin/cleanup/keep')?.body).toEqual({ fileIds: [1, 2] });
  });

  it('deletes only after an explicit confirmation, and Cancel clears the selection', async () => {
    const calls = setup(true);
    await screen.findByText('Larger than 50 GB');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Dune 1979' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected files' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Selected files' })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Alien 1979' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected files' })).getByRole('button', { name: /Delete/ }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Delete permanently/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.click(within(dialog).getByLabelText(/permanently deleted/));
    await userEvent.click(confirm);
    expect(calls.find((c) => c.url === '/api/admin/cleanup/delete')?.body).toEqual({ fileIds: [2], confirm: true });
  });

  it('describes watch status', () => {
    expect(watchStatus({ started: false, watchedBy: 0, lastWatchedAt: null })).toBe('Never watched');
    expect(watchStatus({ started: true, watchedBy: 2, lastWatchedAt: null })).toBe('Watched by 2 users');
    expect(watchStatus({ started: true, watchedBy: 0, lastWatchedAt: null })).toBe('Started, not finished');
  });
});
