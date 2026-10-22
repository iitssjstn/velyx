/** Screens at least this wide (tablets, phones in landscape) get their own layouts. */
export const WIDE_MIN = 720;

export function isWide(width: number): boolean {
  return width >= WIDE_MIN;
}

/**
 * A poster grid for a screen `width` wide: three across on a phone, more when there is room. On a TV
 * the grid keeps away from the screen's edge (TVs cut it off) and leaves room around the poster that
 * grows when chosen.
 */
export function gridLayout(width: number, tv = false): { columns: number; itemWidth: number; side: number; gap: number } {
  const side = tv ? 48 : 16;
  const gap = tv ? 20 : 12;
  const min = tv ? 150 : 130;
  const columns = Math.max(3, Math.floor((width - side) / (min - 12 + gap)));
  return { columns, itemWidth: (width - 2 * side - (columns - 1) * gap) / columns, side, gap };
}
