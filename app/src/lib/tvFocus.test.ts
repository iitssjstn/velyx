import { describe, expect, it } from 'vitest';
import { tvFocusStore } from './tvFocus';

describe('tvFocus', () => {
  it('gives the focus back to the last chosen element after the player, for a moment', () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const store = tvFocusStore((fn, ms) => timers.push({ fn, ms }));
    let changes = 0;
    store.subscribe(() => changes++);
    store.remember('poster-1');
    store.remember('play-button');
    expect(store.preferred('play-button')).toBe(false);
    store.restore();
    expect(timers[0]!.ms).toBe(400);
    timers[0]!.fn();
    expect(store.preferred('play-button')).toBe(true);
    expect(store.preferred('poster-1')).toBe(false);
    timers[1]!.fn();
    expect(store.preferred('play-button')).toBe(false);
    expect(changes).toBe(2);
  });

  it('asks nothing before anything had the focus', () => {
    const store = tvFocusStore((fn) => fn());
    store.restore();
    expect(store.preferred('x')).toBe(false);
  });
});
