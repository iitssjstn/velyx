/**
 * On a TV the app stays in memory when the TV goes off or the screensaver starts, so hours later it
 * still showed the page it was left on. After half an hour without anyone using it (no key pressed,
 * nothing playing; the time away from the app counts too) it goes back to Home with fresh lists.
 * The app is not closed or restarted: Android advises against that, and a restart is slower.
 */
export const IDLE_RESET_MS = 30 * 60_000;

/** Paths of the signed-in app; signing in and choosing a server are left alone. */
export function resettable(pathname: string): boolean {
  return pathname !== '/' && !pathname.startsWith('/cloud');
}

export function idleTracker(now: () => number = Date.now, limit = IDLE_RESET_MS) {
  let last = now();
  let playing = false;
  return {
    /** A key was pressed (something got the focus) or the app came back. */
    touch() {
      last = now();
    },
    /** Playing counts as being used; the half hour starts when it stops (pause, end, leaving the player). */
    setPlaying(on: boolean) {
      playing = on;
      last = now();
    },
    /** Whether it is time to go back to Home; asking again counts from then on. */
    due(): boolean {
      if (playing || now() - last < limit) return false;
      last = now();
      return true;
    },
  };
}

export const idle = idleTracker();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Home on a TV starts fresh after a reset (back to the top, first row chosen). */
export const homeReset = {
  count: 0,
  fire() {
    homeReset.count++;
    listeners.forEach((l) => l());
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
