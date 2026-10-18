/**
 * Vidalune's own dark screen with the logo (and the title being started) until the TV plays: while
 * there is nothing on the TV, and while a title is being loaded.
 */
export function showsSplash(playerState) {
  return !['PLAYING', 'PAUSED', 'BUFFERING'].includes(String(playerState ?? 'IDLE'));
}
