import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { createMemoryRouter, Link, RouterProvider, Outlet } from 'react-router-dom';
import { PlaybackSessionProvider } from '../lib/playback-session';
import type { PlayerProps } from '../pages/Player';

// A stand-in for the real player: counts mounts so the test can prove the same instance lives on.
const mounts = { count: 0 };
vi.mock('../pages/Player', () => ({
  default: function FakePlayer(p: PlayerProps) {
    useEffect(() => {
      mounts.count++;
    }, []);
    return (
      <div data-testid="player" data-mini={String(p.mini)} data-item={`${p.kind}:${p.id}`}>
        <button onClick={() => p.onMinimize('/movies/1')}>minimize</button>
        <button onClick={p.onRestore}>restore</button>
        <button onClick={() => p.onClose('/movies/1')}>close</button>
        <button onClick={() => p.onPlayItem('episode', 7)}>next</button>
      </div>
    );
  },
}));

const { PlayerHost, PlayRoute } = await import('./PlayerHost');

function Shell() {
  return (
    <PlaybackSessionProvider>
      <nav>
        <Link to="/shows">shows</Link>
        <Link to="/play/movie/1">play 1</Link>
        <Link to="/play/movie/2">play 2</Link>
      </nav>
      <Outlet />
      <PlayerHost />
    </PlaybackSessionProvider>
  );
}

function setup(start = '/movies/1') {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/play/:kind/:id', element: <PlayRoute /> },
          { path: '/movies/:id', element: <p>movie page</p> },
          { path: '/shows', element: <p>shows page</p> },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const player = () => screen.findByTestId('player');
afterEach(() => {
  mounts.count = 0;
});

describe('mini-player', () => {
  it('keeps the same player instance through minimize, browsing and restore', async () => {
    const router = setup();
    await act(() => router.navigate('/play/movie/1'));
    expect((await player()).dataset.mini).toBe('false');
    expect(mounts.count).toBe(1);

    await act(async () => screen.getByText('minimize').click());
    expect(router.state.location.pathname).toBe('/movies/1');
    expect((await player()).dataset.mini).toBe('true');

    await act(() => router.navigate('/shows'));
    expect(screen.getByText('shows page')).toBeTruthy();
    expect((await player()).dataset.mini).toBe('true');

    await act(async () => screen.getByText('restore').click());
    expect(router.state.location.pathname).toBe('/play/movie/1');
    expect((await player()).dataset.mini).toBe('false');
    // Never unmounted or re-created: no new stream, no reset of position, audio or subtitles.
    expect(mounts.count).toBe(1);
  });

  it('plays the next episode inside the mini-player without leaving the page', async () => {
    const router = setup();
    await act(() => router.navigate('/play/movie/1'));
    await act(async () => (await player()).querySelector('button')!.click());
    await act(async () => screen.getByText('next').click());
    expect((await player()).dataset.item).toBe('episode:7');
    expect((await player()).dataset.mini).toBe('true');
    expect(router.state.location.pathname).toBe('/movies/1');
  });

  it('closes when the viewer leaves the full player or presses close', async () => {
    const router = setup();
    await act(() => router.navigate('/play/movie/1'));
    await player();
    await act(() => router.navigate(-1));
    expect(screen.queryByTestId('player')).toBeNull();

    await act(() => router.navigate('/play/movie/1'));
    await act(async () => screen.getByText('minimize').click());
    await act(async () => screen.getByText('close').click());
    expect(screen.queryByTestId('player')).toBeNull();
    expect(router.state.location.pathname).toBe('/movies/1');
  });

  it('starting another item replaces the minimized one', async () => {
    const router = setup();
    await act(() => router.navigate('/play/movie/1'));
    await act(async () => screen.getByText('minimize').click());
    await act(() => router.navigate('/play/movie/2'));
    const p = await player();
    expect(p.dataset.item).toBe('movie:2');
    expect(p.dataset.mini).toBe('false');
    expect(screen.getAllByTestId('player')).toHaveLength(1);
  });
});
