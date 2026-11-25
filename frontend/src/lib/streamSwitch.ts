/**
 * The loading note while the player changes to a new stream (other voices, another audio track, a seek
 * in a stream the server converts): the player stops where it was and says what it is doing, until
 * the new stream really plays. The same rules on the website, the phone and the TV.
 */

export type SwitchReason = 'voices' | 'audio' | 'seek' | 'load';

export interface Switching {
  reason: SwitchReason;
  /** The new stream has started loading: from now on, being ready means it is the new one. */
  loading: boolean;
}

export type SwitchEvent = { type: 'start'; reason: SwitchReason } | { type: 'loading' } | { type: 'ready' } | { type: 'done' } | { type: 'failed' };

/**
 * What the note does on an event. It shows from `start`; the old stream may still say it is ready, so
 * only a `ready` after the new one began `loading` ends it. `done` ends it at once (the player changed
 * without a new stream), `failed` too (the player shows why).
 */
export function nextSwitch(state: Switching | null, event: SwitchEvent): Switching | null {
  switch (event.type) {
    case 'start':
      return { reason: event.reason, loading: false };
    case 'loading':
      return state ? { ...state, loading: true } : null;
    case 'ready':
      return state?.loading ? null : state;
    case 'done':
    case 'failed':
      return null;
  }
}

/** The words for each reason (a key of the texts). */
export function switchLabel(reason: SwitchReason): `player.switching.${SwitchReason}` {
  return `player.switching.${reason}`;
}
