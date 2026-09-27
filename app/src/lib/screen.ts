/**
 * How the screen turns. Phones stay upright and only the player is in landscape (and the
 * navigation bar hidden); tablets turn freely everywhere.
 */

export type DeviceKind = 'phone' | 'tablet' | 'unknown';

/** A tablet as Android reports it, or, when it does not know, a screen at least 600 points on its short side. */
export function isTablet(kind: DeviceKind, shortSide: number): boolean {
  return kind === 'tablet' || (kind === 'unknown' && shortSide >= 600);
}

export interface ScreenEffects {
  /** Landscape and full screen, for playback. */
  player(): void;
  /** Back to the rest of the app: upright on a phone, free on a tablet; navigation bar back. */
  app(): void;
}

/**
 * Counts open players. When the next episode starts, its player opens before the previous one
 * closes; only the last one to close may give the screen back to the app, or the next episode
 * would play upright with the navigation bar showing.
 */
export function playerScreen(effects: ScreenEffects) {
  let open = 0;
  return {
    enter() {
      open += 1;
      if (open === 1) effects.player();
    },
    leave() {
      if (open === 0) return;
      open -= 1;
      if (open === 0) effects.app();
    },
    get open() {
      return open;
    },
  };
}
