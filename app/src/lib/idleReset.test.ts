import { describe, expect, it } from 'vitest';
import { IDLE_RESET_MS, homeReset, idleTracker, resettable } from './idleReset';

const clock = () => {
  let t = 0;
  return { now: () => t, add: (ms: number) => (t += ms) };
};

describe('back to Home on a TV after a while', () => {
  it('waits half an hour without use', () => {
    const c = clock();
    const idle = idleTracker(c.now);
    c.add(IDLE_RESET_MS - 1);
    expect(idle.due()).toBe(false);
    c.add(1);
    expect(idle.due()).toBe(true);
  });

  it('counts again from every key press', () => {
    const c = clock();
    const idle = idleTracker(c.now);
    c.add(IDLE_RESET_MS - 1000);
    idle.touch();
    c.add(IDLE_RESET_MS - 1000);
    expect(idle.due()).toBe(false);
  });

  it('never while something plays, and counts from when it stopped', () => {
    const c = clock();
    const idle = idleTracker(c.now);
    idle.setPlaying(true);
    c.add(3 * IDLE_RESET_MS);
    expect(idle.due()).toBe(false);
    idle.setPlaying(false);
    c.add(IDLE_RESET_MS - 1);
    expect(idle.due()).toBe(false);
    c.add(1);
    expect(idle.due()).toBe(true);
  });

  it('goes back once, then counts anew', () => {
    const c = clock();
    const idle = idleTracker(c.now);
    c.add(IDLE_RESET_MS);
    expect(idle.due()).toBe(true);
    expect(idle.due()).toBe(false);
    c.add(IDLE_RESET_MS);
    expect(idle.due()).toBe(true);
  });

  it('leaves signing in and choosing a server alone', () => {
    expect(resettable('/')).toBe(false);
    expect(resettable('/cloud')).toBe(false);
    expect(resettable('/home')).toBe(true);
    expect(resettable('/show/12')).toBe(true);
    expect(resettable('/play/episode/4')).toBe(true);
  });

  it('tells Home to start fresh', () => {
    let heard = 0;
    const stop = homeReset.subscribe(() => heard++);
    const before = homeReset.count;
    homeReset.fire();
    stop();
    homeReset.fire();
    expect(heard).toBe(1);
    expect(homeReset.count).toBe(before + 2);
  });
});
