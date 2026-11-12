import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideSplash, reloadSplash as hidden, resetSplash, splashDelay, SPLASH_MIN_MS } from './splash';

beforeEach(() => {
  vi.useFakeTimers();
  resetSplash();
  document.body.innerHTML = '<div id="splash"></div><div id="root"></div>';
});
afterEach(() => vi.useRealTimers());

describe('the opening screen', () => {
  it('stays long enough to see the logo, and not longer than needed', () => {
    expect(splashDelay(0)).toBe(SPLASH_MIN_MS);
    expect(splashDelay(300)).toBe(SPLASH_MIN_MS - 300);
    // The app took longer than the minimum: it fades out at once.
    expect(splashDelay(2500)).toBe(0);
  });

  it('fades out once the app is ready, and is gone afterwards', () => {
    hideSplash(() => 600);
    const el = document.getElementById('splash')!;
    expect(el.classList.contains('done')).toBe(false);
    vi.advanceTimersByTime(300);
    expect(el.classList.contains('done')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(document.getElementById('splash')).toBeNull();
    // A second call (e.g. the safety timeout) does nothing.
    expect(() => hideSplash(() => 5000)).not.toThrow();
  });

  it('does not keep the logo up again after a refresh in the same tab', () => {
    hideSplash(() => 100);
    vi.advanceTimersByTime(2000);
    // The page is loaded again: ready after 100 ms, and the opening screen goes at once.
    hidden();
    document.body.innerHTML = '<div id="splash"></div>';
    hideSplash(() => 100);
    vi.advanceTimersByTime(1);
    expect(document.getElementById('splash')!.classList.contains('done')).toBe(true);
  });
});
