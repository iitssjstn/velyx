import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
