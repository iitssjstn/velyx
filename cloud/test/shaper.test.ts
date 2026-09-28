import { describe, expect, it } from 'vitest';
import { mbpsToBps, Shaper } from '../src/shaper.js';

describe('sharing the relay fairly', () => {
  it('gives every server that is sending an equal part, and never more than its own limit', () => {
    let clock = 1_000_000;
    const shaper = new Shaper({ totalBps: () => mbpsToBps(800), now: () => clock });
    expect(mbpsToBps(8)).toBe(1_000_000);
    // Alone: the whole relay.
    expect(shaper.rate('a', 0)).toBe(100_000_000);
    shaper.delay('a', 1, 0);
    // A second one starts: half each.
    expect(shaper.rate('b', 0)).toBe(50_000_000);
    shaper.delay('b', 1, 0);
    expect(shaper.rate('a', 0)).toBe(50_000_000);
    expect(shaper.active()).toBe(2);
    // Its own limit is lower than its share.
    expect(shaper.rate('b', mbpsToBps(80))).toBe(10_000_000);
    // Quiet for a while: no longer counted.
    clock += 3000;
    shaper.delay('a', 1, 0);
    expect(shaper.active()).toBe(1);
    expect(shaper.rate('a', 0)).toBe(100_000_000);
  });

  it('makes a server wait once it runs ahead of its rate', () => {
    let clock = 1_000_000;
    const shaper = new Shaper({ totalBps: () => 0, now: () => clock });
    const cap = 1_000_000; // bytes per second
    // A quarter of a second's worth at once, then waiting.
    expect(shaper.delay('a', 250_000, cap)).toBe(0);
    expect(shaper.delay('a', 500_000, cap)).toBe(500);
    clock += 500;
    expect(shaper.delay('a', 100_000, cap)).toBe(100);
    // No limit anywhere: never waits.
    expect(shaper.delay('b', 50_000_000, 0)).toBe(0);
  });
});
