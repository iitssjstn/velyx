/**
 * Between connecting and the film, Google's cast player shows its own white screen (its colours
 * cannot be set there). Vidalune covers it with its own dark one, with the logo, until the TV
 * plays: while there is nothing on the TV, and while a title is being loaded.
 */
export function showsSplash(playerState) {
  return !['PLAYING', 'PAUSED', 'BUFFERING'].includes(String(playerState ?? 'IDLE'));
}
