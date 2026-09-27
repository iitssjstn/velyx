/** Screens at least this wide (tablets, phones in landscape) get their own layouts. */
export const WIDE_MIN = 720;

export function isWide(width: number): boolean {
  return width >= WIDE_MIN;
}

/** A poster grid for a screen `width` wide: three across on a phone, more when there is room. */
export function gridLayout(width: number): { columns: number; itemWidth: number } {
  const columns = Math.max(3, Math.floor((width - 16) / 130));
  return { columns, itemWidth: (width - 32 - (columns - 1) * 12) / columns };
}
