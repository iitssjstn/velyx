import { describe, expect, it, vi } from 'vitest';
import { isTablet, playerScreen } from './screen';

describe('isTablet', () => {
  it('follows what Android reports', () => {
    expect(isTablet('tablet', 400)).toBe(true);
    expect(isTablet('phone', 700)).toBe(false);
  });
  it('falls back to the screen size', () => {
    expect(isTablet('unknown', 800)).toBe(true);
    expect(isTablet('unknown', 390)).toBe(false);
  });
});

describe('playerScreen', () => {
  it('goes to landscape when a player opens and back when it closes', () => {
    const effects = { player: vi.fn(), app: vi.fn() };
    const screen = playerScreen(effects);
    screen.enter();
    expect(effects.player).toHaveBeenCalledTimes(1);
    screen.leave();
    expect(effects.app).toHaveBeenCalledTimes(1);
  });
  it('stays in the player while the next episode takes over', () => {
    const effects = { player: vi.fn(), app: vi.fn() };
    const screen = playerScreen(effects);
    screen.enter(); // episode 1
    screen.enter(); // episode 2 opens
    screen.leave(); // episode 1 closes
    expect(effects.app).not.toHaveBeenCalled();
    expect(effects.player).toHaveBeenCalledTimes(1);
    screen.leave(); // episode 2 closes
    expect(effects.app).toHaveBeenCalledTimes(1);
  });
  it('ignores a close without an open', () => {
    const effects = { player: vi.fn(), app: vi.fn() };
    const screen = playerScreen(effects);
    screen.leave();
    expect(effects.app).not.toHaveBeenCalled();
    expect(screen.open).toBe(0);
  });
});
