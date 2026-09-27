import { describe, expect, it } from 'vitest';
import { seekTarget } from './seek';

describe('seekTarget', () => {
  it('follows the finger from where it went down', () => {
    expect(seekTarget(100, 0, 400, 2000)).toBe(500);
    expect(seekTarget(100, 100, 400, 2000)).toBe(1000);
    expect(seekTarget(100, -50, 400, 2000)).toBe(250);
  });
  it('stays within the start and the end', () => {
    expect(seekTarget(100, -300, 400, 2000)).toBe(0);
    expect(seekTarget(300, 500, 400, 2000)).toBe(2000);
  });
  it('is 0 before the bar or the duration is known', () => {
    expect(seekTarget(100, 0, 0, 2000)).toBe(0);
    expect(seekTarget(100, 0, 400, 0)).toBe(0);
  });
});
