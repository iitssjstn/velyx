/**
 * A player left open (paused) must not undo what was watched elsewhere meanwhile. Pause on the TV,
 * watch on in the browser, then close the TV's player: the TV used to save its own, older spot over
 * the newer one.
 */

/** A pause at least this long: on playing again, the spot saved elsewhere is looked up first. */
export const LONG_PAUSE_MS = 2 * 60_000;
/** Closer than this to the last save: nothing new to save. */
const SAME_SPOT_SEC = 2;
/** The spot saved elsewhere counts as newer only when it differs this much from the last one saved here. */
const MOVED_ELSEWHERE_SEC = 15;

/** Whether leaving (or pausing) should save `position`: only when it moved since the last save here. */
export function savesOnLeave(position: number, lastSaved: number | null): boolean {
  return lastSaved === null || Math.abs(position - lastSaved) >= SAME_SPOT_SEC;
}

/**
 * Where to continue after a long pause, when the spot saved for this title now differs from the one
 * this player saved last (someone watched on elsewhere); null: carry on here.
 */
export function watchedElsewhere(lastSaved: number | null, saved: { positionSec: number; completed?: boolean } | null | undefined): number | null {
  if (lastSaved === null || !saved || saved.completed) return null;
  return Math.abs(saved.positionSec - lastSaved) >= MOVED_ELSEWHERE_SEC ? saved.positionSec : null;
}
