import { describe, expect, it } from 'vitest';
import { LAUNCH_MAX_MS, LAUNCH_MIN_MS, launchHideAt } from './launch';

describe('the opening screen of the app', () => {
  it('shows the logo long enough to see it, and goes as soon as the app is ready after that', () => {
    expect(launchHideAt(100)).toBe(LAUNCH_MIN_MS);
    expect(launchHideAt(2000)).toBe(2000);
  });

  it('never stays longer than the maximum, also when the app never gets ready', () => {
    expect(launchHideAt(9000)).toBe(LAUNCH_MAX_MS);
    expect(launchHideAt(null)).toBe(LAUNCH_MAX_MS);
  });
});
