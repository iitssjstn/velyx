import { describe, expect, it } from 'vitest';
import { seasonsToRequest, tickSeason } from './request-seasons';

describe('seasons to request', () => {
  it('starts with nothing ticked, and asks for exactly what was ticked', () => {
    expect(seasonsToRequest([], [3, 4, 5])).toEqual([]);
    expect(seasonsToRequest([5, 3], [3, 4, 5])).toEqual([3, 5]);
    // Seasons that are not open (here or on their way) never count.
    expect(seasonsToRequest([1, 3], [3, 4, 5])).toEqual([3]);
  });

  it('asks for the whole show when every open season is ticked', () => {
    expect(seasonsToRequest([3, 4, 5], [3, 4, 5])).toBeNull();
  });

  it('ticks and unticks one season', () => {
    expect(tickSeason([], 2, true)).toEqual([2]);
    expect(tickSeason([2], 2, true)).toEqual([2]);
    expect(tickSeason([2, 3], 2, false)).toEqual([3]);
  });
});
