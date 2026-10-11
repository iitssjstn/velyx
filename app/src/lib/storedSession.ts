/**
 * The stored session as it is now, for changes made right after each other (choose a server, then
 * sign in to it). React state in a callback is the value of an earlier render, so a change based on
 * it would bring back the session from before the first change.
 */
export function createStoredSession<S>(persist: (next: S | null) => Promise<void>) {
  let current: S | null = null;
  return {
    current: () => current,
    /** The session read at app start (not written back). */
    load(value: S | null) {
      current = value;
    },
    save(next: S | null) {
      current = next;
      return persist(next);
    },
    /** Changes the latest session; nothing when there is none. */
    change(update: (session: S) => S | null) {
      const next = current ? update(current) : null;
      current = next;
      return persist(next);
    },
  };
}
