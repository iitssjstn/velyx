/**
 * Whether a Chromecast is connected, known at once everywhere in the app (the Cast SDK's own hooks
 * only answer after a moment). The player uses it to open straight as the TV's remote, and the
 * cast buttons to show that a connection is being made.
 */
export type CastStatus = 'none' | 'connecting' | 'connected';

let current: CastStatus = 'none';
const listeners = new Set<() => void>();

export function castStatus(): CastStatus {
  return current;
}

export function setCastStatus(next: CastStatus): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeCastStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The Cast SDK's state (`connecting`, `connected`, …) as Vidalune uses it. */
export function castStatusOf(state: string | null | undefined): CastStatus {
  return state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : 'none';
}

/**
 * Where the TV starts: where the phone is, or, when nothing has played on the phone yet (a title
 * opened while already casting), where the viewer was meant to start (the resume point).
 */
export function castStartAt(position: number, wanted: number | null): number {
  return position > 0 ? position : Math.max(0, wanted ?? 0);
}
