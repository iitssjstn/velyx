import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * The item that is playing, kept above the page routes so playback survives navigation: the full
 * player and the mini-player are the same component (and the same <video> element) in two layouts.
 */
export interface PlaybackSession {
  kind: 'movie' | 'episode';
  id: number;
  /** Query string the item was started with (?t=, ?file=). Only read when playback starts. */
  search: string;
}

interface SessionContext {
  session: PlaybackSession | null;
  mini: boolean;
  /** Plays an item full screen. The same item that is already playing is just brought back. */
  open: (next: PlaybackSession) => void;
  setMini: (mini: boolean) => void;
  /** Switches to another item without changing the layout (next episode in the mini-player). */
  switchTo: (next: PlaybackSession) => void;
  close: () => void;
  /** Read synchronously by the /play route when it unmounts (minimize vs. leaving the player). */
  miniRef: React.MutableRefObject<boolean>;
}

const Ctx = createContext<SessionContext | null>(null);

export function PlaybackSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [mini, setMiniState] = useState(false);
  const miniRef = useRef(false);

  const setMini = useCallback((m: boolean) => {
    miniRef.current = m;
    setMiniState(m);
  }, []);

  const open = useCallback(
    (next: PlaybackSession) => {
      setSession((cur) => (cur && cur.kind === next.kind && cur.id === next.id ? cur : next));
      setMini(false);
    },
    [setMini],
  );

  const switchTo = useCallback((next: PlaybackSession) => setSession(next), []);

  const close = useCallback(() => {
    setSession(null);
    setMini(false);
  }, [setMini]);

  const value = useMemo(() => ({ session, mini, open, setMini, switchTo, close, miniRef }), [session, mini, open, setMini, switchTo, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlaybackSession(): SessionContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlaybackSession needs PlaybackSessionProvider');
  return ctx;
}
