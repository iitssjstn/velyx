import { describe, expect, it } from 'vitest';
import { nextSpeed, SPEEDS, speedLabel } from './speed';

describe('playback speed', () => {
  it('has the speeds of the website', () => {
    expect(SPEEDS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });
  it('goes to the next speed, and from the fastest back to the slowest', () => {
    expect(nextSpeed(1)).toBe(1.25);
    expect(nextSpeed(2)).toBe(0.5);
    // An unknown speed starts over at the slowest.
    expect(nextSpeed(3)).toBe(0.5);
  });
  it('writes the speed in the language of the app', () => {
    expect(speedLabel(1.25, 'nl')).toBe('1,25×');
    expect(speedLabel(1.25, 'en')).toBe('1.25×');
  });
});
