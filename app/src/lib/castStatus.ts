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

/** How far before the asked start the TV may begin (it starts at a keyframe) and still count as there. */
export const CAST_START_SLACK_SEC = 15;

/**
 * Whether the TV got to where it was asked to start (the resume point), once it reports `at` (in the
 * file). Until then its position is not saved: a TV that begins at the start of the stream first
 * would otherwise overwrite the resume point. Once there, seeking back is the viewer's choice.
 */
export function castSettled(already: boolean, at: number, startedAt: number): boolean {
  return already || at + CAST_START_SLACK_SEC >= startedAt;
}
