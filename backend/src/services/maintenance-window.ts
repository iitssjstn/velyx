/** "HH:MM" (24-hour clock), local server time. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Whether `now` (local server time, which TZ sets) falls in the maintenance window from `start` up to
 * `end`. A window may run past midnight (22:00–04:00).
 */
export function inMaintenanceWindow(now: Date, start: string, end: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const from = minutes(start);
  const to = minutes(end);
  return from <= to ? t >= from && t < to : t >= from || t < to;
}
