import type { Messages } from '../index';
export const schedule: Messages['schedule'] = {
  off: 'Uit',
  waitingForPlayback: 'Wacht tot niemand meer kijkt',
  next: 'Volgende {when} ({interval})',
  everyDays: {
    one: 'Elke dag',
    other: 'Elke {count} dagen',
  },
  everyHours: {
    one: 'Elk uur',
    other: 'Elke {count} uur',
  },
  everyMinutes: {
    one: 'Elke minuut',
    other: 'Elke {count} minuten',
  },
};
