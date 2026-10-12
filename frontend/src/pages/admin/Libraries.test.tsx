import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// The settings panel on this page has its own test (SettingsPanels.test.tsx).
vi.mock('./SettingsPanels', () => ({ ScanSettings: () => null }));

import { LibrariesPanel } from './Libraries';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
      if (url === '/api/libraries') return json({ libraries: [], mediaRoots: ['/srv'] });
      if (url === '/api/libraries/scan-status') return json({ status: 'idle', running: null, queued: [], paused: null, lastSuccess: null, lastFailure: null, schedule: { intervalMinutes: 360, nextAt: null, waitingForPlayback: false } });
      if (url === '/api/libraries/folders') return json({ path: null, parent: null, folders: [{ name: '/srv', path: '/srv', readable: true }] });
      if (url === '/api/libraries/folders?path=%2Fsrv')
        return json({
          path: '/srv',
          parent: null,
          folders: [
            { name: 'movies', path: '/srv/movies', readable: true },
            { name: 'private', path: '/srv/private', readable: false },
          ],
        });
      if (url === '/api/libraries/folders?path=%2Fsrv%2Fmovies') return json({ path: '/srv/movies', parent: '/srv', folders: [] });
      if (url === '/api/libraries/folders?path=%2Fsrv%2Fprivate') return json({ error: "Vidalune may not read /srv/private. Give it access on the server with: sudo setfacl -R -m u:vidalune:rX '/srv/private'" }, 400);
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LibrariesPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return asked;
}

describe('choosing a library folder', () => {
  it('browses the folders on the server and fills in the chosen one', async () => {
    setup();
    await userEvent.click((await screen.findAllByRole('button', { name: /Add library/ }))[0]);
    const input = screen.getByLabelText('Folder') as HTMLInputElement;
    expect(input.value).toBe('/srv/');
    expect(screen.getByText('This is a media root and may include many folders. Choose a narrower folder if you only want one library.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await userEvent.click(await screen.findByRole('button', { name: 'movies' }));
    expect(await screen.findByText('No folders here.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(input.value).toBe('/srv/movies');
    expect(screen.queryByText('This is a media root and may include many folders. Choose a narrower folder if you only want one library.')).toBeNull();
    expect(screen.queryByText('No folders here.')).toBeNull();
  });

  it('marks folders Vidalune may not read and shows how to give access', async () => {
    setup();
    await userEvent.click((await screen.findAllByRole('button', { name: /Add library/ }))[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Browse' }));
    const locked = await screen.findByTitle('Vidalune may not read this folder');
    await userEvent.click(locked);
    expect((await screen.findByRole('alert')).textContent).toContain("sudo setfacl -R -m u:vidalune:rX '/srv/private'");
  });
});

describe('a library whose folder came back empty', () => {
  it('keeps the titles, says why, and removes them only after the administrator confirms', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    const library = {
      id: 4, name: 'Movies', type: 'movies', path: '/media/movies', createdAt: 0, lastScanAt: Date.now(), lastScanStatus: 'empty', lastScanMessage: '12 files kept',
      lastScanDurationMs: 10, lastSuccessAt: Date.now(), lastFailureAt: null, itemCount: 12, fileCount: 12, available: true, scanning: null, queued: false, watching: false, watchError: null, restricted: false,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ queued: true });
      }
      if (url === '/api/libraries') return json({ libraries: [library], mediaRoots: ['/media'] });
      if (url === '/api/libraries/scan-status') return json({ status: 'idle', running: null, queued: [], paused: null, lastSuccess: null, lastFailure: null, schedule: { intervalMinutes: 360, nextAt: null, waitingForPlayback: false } });
      return json({});
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <LibrariesPanel />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/The folder was empty at the last scan. The 12 files Vidalune knows are kept/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove titles' }));
    expect(await screen.findByText(/The folder \/media\/movies of “Movies” is empty/)).toBeTruthy();
    expect(posts).toEqual([]);
    const buttons = screen.getAllByRole('button', { name: 'Remove titles' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await vi.waitFor(() => expect(posts).toEqual([{ url: '/api/libraries/4/scan', body: { confirmEmpty: true } }]));
  });
});
