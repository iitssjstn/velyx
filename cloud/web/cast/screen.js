/**
 * Vidalune's own dark screen with the logo (and the title being started) until the TV plays: while
 * there is nothing on the TV, and while a title is being loaded.
 */
export function showsSplash(playerState) {
  return !['PLAYING', 'PAUSED', 'BUFFERING'].includes(String(playerState ?? 'IDLE'));
}

/**
 * How the player starts Google's framework. Vidalune draws its own controls, so the framework must
 * not draw its own over them (its bar with 30 s buttons and CC): `touchScreenOptimizedApp` tells it
 * the page has its own layout.
 */
export function startOptions(UiConfig) {
  const uiConfig = new UiConfig();
  uiConfig.touchScreenOptimizedApp = true;
  return { uiConfig };
}
