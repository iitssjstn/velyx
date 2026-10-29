import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StorageCard, StorageWarning } from './Dashboard';
import type { Dashboard } from '../../lib/types';

const GB = 1024 ** 3;

describe('StorageWarning', () => {
  it('shows nothing while space is fine', () => {
    const { container } = render(<StorageWarning disk={{ total: 500 * GB, used: 100 * GB, free: 400 * GB, level: 'ok' }} />);
    expect(container.textContent).toBe('');
  });

  it('warns when space is low', () => {
    render(<StorageWarning disk={{ total: 500 * GB, used: 492 * GB, free: 8 * GB, level: 'low' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Storage running low');
  });

  it('explains that scans pause when space is critical', () => {
    render(<StorageWarning disk={{ total: 500 * GB, used: 498.6 * GB, free: 1.4 * GB, level: 'critical' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Storage critically low');
    expect(alert.textContent).toContain('1.4 GB remaining');
    expect(alert.textContent).toContain('scans and scheduled backups are paused');
  });
});

describe('library storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('warns about the disk of the libraries by their names', () => {
    render(<StorageWarning disk={{ total: 4000 * GB, used: 3990 * GB, free: 10 * GB, level: 'low' }} names="Movies, Shows" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Library storage running low (Movies, Shows) · 10.0 GB remaining');
    expect(alert.textContent).not.toContain('scans and scheduled backups are paused');
  });

  it("shows Vidalune's own storage and one bar per disk the libraries are on", () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(null), { status: 200 })));
    const dashboard = {
      disk: { total: 500 * GB, used: 100 * GB, free: 400 * GB, level: 'ok' },
      mediaDisks: [{ total: 4000 * GB, used: 3000 * GB, free: 1000 * GB, level: 'ok', libraries: [{ id: 1, name: 'Movies' }, { id: 2, name: 'Shows' }] }],
      storage: {
        mediaBytes: 0,
        databaseBytes: 0,
        cacheBytes: 0,
        dataDisk: null,
        libraries: [
          { id: 1, name: 'Movies', path: '/media/movies', disk: { total: 4000 * GB, free: 1000 * GB } },
          { id: 2, name: 'Shows', path: '/media/tv', disk: { total: 4000 * GB, free: 1000 * GB } },
          { id: 3, name: 'Old', path: '/media/old', disk: null },
        ],
      },
      counts: { files: 0 },
    } as unknown as Dashboard;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StorageCard dashboard={dashboard} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('meter', { name: 'Vidalune storage' })).toBeTruthy();
    // Movies and Shows are on the same disk: one bar with both names, not two.
    expect(screen.getByRole('meter', { name: 'Library: Movies, Shows' }).getAttribute('aria-valuenow')).toBe('75');
    expect(screen.queryByRole('meter', { name: 'Movies' })).toBeNull();
    expect(screen.getByText(/Old: folder not available/)).toBeTruthy();
  });
});
