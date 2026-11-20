/** Playback speeds, as on the website. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

/** The speed after `current` (after the fastest: the slowest again), for one button on the TV. */
export function nextSpeed(current: number): Speed {
  const at = SPEEDS.findIndex((s) => s === current);
  return SPEEDS[(at + 1) % SPEEDS.length]!;
}

/** "1,25×" in the app's language. */
export function speedLabel(speed: number, language: string): string {
  return `${speed.toLocaleString(language)}×`;
}
