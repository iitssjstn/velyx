import { lazy, Suspense, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { usePlaybackSession } from '../lib/playback-session';
import { FullscreenLoader } from './States';

// Loaded on demand to keep the initial bundle small.
const Player = lazy(() => import('../pages/Player'));

/**
 * The /play/:kind/:id route. It only tells the host what to play; the host renders the player
 * outside the page routes, so it keeps playing (minimized) while the user browses.
 */
export function PlayRoute() {
  const { kind, id } = useParams();
  const { search } = useLocation();
  const { open, close, miniRef } = usePlaybackSession();
  useEffect(() => {
    open({ kind: kind === 'episode' ? 'episode' : 'movie', id: Number(id), search });
    // `search` (?t=, ?file=) only matters when an item starts; changing it must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, open]);
  // Leaving the player page without minimizing (Back, a link) ends playback, as before.
  useEffect(() => () => void (miniRef.current || close()), [close, miniRef]);
  return null;
}

/** Renders the one player instance: full screen on /play, as a mini-player everywhere else. */
export function PlayerHost() {
  const { session, mini, setMini, switchTo, close } = usePlaybackSession();
  const navigate = useNavigate();
  // On phones the mini-player is a bar along the bottom: keep page content scrollable above it.
  useEffect(() => {
    document.documentElement.classList.toggle('has-mini-player', Boolean(session && mini));
    return () => document.documentElement.classList.remove('has-mini-player');
  }, [session, mini]);
  if (!session) return null;

  // Going back is only safe when the previous entry belongs to this app session (React Router
  // numbers its entries); otherwise it would reload the page and end playback.
  const leavePlayerPage = (backHref: string | undefined) => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(backHref ?? '/', { replace: true });
  };

  return (
    <Suspense fallback={mini ? null : <FullscreenLoader />}>
      <Player
        kind={session.kind}
        id={session.id}
        search={session.search}
        mini={mini}
        onMinimize={(backHref) => {
          setMini(true);
          leavePlayerPage(backHref);
        }}
        onRestore={() => navigate(`/play/${session.kind}/${session.id}`)}
        onClose={(backHref) => {
          const wasMini = mini;
          close();
          if (!wasMini) leavePlayerPage(backHref);
        }}
        onPlayItem={(kind, id) => {
          if (mini) switchTo({ kind, id, search: '' });
          else navigate(`/play/${kind}/${id}`, { replace: true });
        }}
      />
    </Suspense>
  );
}
