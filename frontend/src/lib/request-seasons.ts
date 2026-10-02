/**
 * The seasons of a show to request, from the ones ticked (nothing is ticked beforehand). Only seasons
 * still open count; every open season ticked means the whole show (null: Seerr requests "all").
 */
export function seasonsToRequest(ticked: number[], open: number[]): number[] | null {
  const chosen = [...new Set(ticked.filter((n) => open.includes(n)))].sort((a, b) => a - b);
  return open.length > 0 && chosen.length === open.length ? null : chosen;
}

/** Ticks or unticks one season. */
export function tickSeason(ticked: number[], season: number, on: boolean): number[] {
  return on ? [...new Set([...ticked, season])] : ticked.filter((n) => n !== season);
}
