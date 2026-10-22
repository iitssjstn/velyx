/**
 * Where the focus goes back to after the player on a TV: the button or poster that was chosen last
 * (the one that opened the player). Leaving the player could leave the focus on nothing, and then
 * the remote's arrows did nothing until the app was restarted.
 */
type Listener = () => void;

export function tvFocusStore(schedule: (fn: () => void, ms: number) => unknown = setTimeout) {
  let last: string | null = null;
  let armed = false;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    /** Something got the focus. */
    remember(id: string) {
      last = id;
    },
    /** Whether `id` should take the focus now. */
    preferred(id: string): boolean {
      return armed && last === id;
    },
    /**
     * The player closed: once the screen underneath is back (its transition takes a moment), the
     * last chosen element takes the focus; a moment later that wish is dropped again, so it can be
     * asked for the next time (the native side reacts to it turning on).
     */
    restore(after = 400, hold = 1200) {
      schedule(() => {
        armed = true;
        emit();
        schedule(() => {
          armed = false;
          emit();
        }, hold);
      }, after);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const tvFocus = tvFocusStore();
