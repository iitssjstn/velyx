import { describe, expect, it } from 'vitest';
import { ago } from './format';

describe('ago', () => {
  const now = 1_000_000_000_000;
  it('says just now within a minute', () => {
    expect(ago(now - 30_000, now)).toEqual({ key: 'time.justNow', n: 0 });
    expect(ago(now + 5_000, now)).toEqual({ key: 'time.justNow', n: 0 });
  });
  it('counts minutes, hours and days', () => {
    expect(ago(now - 5 * 60_000, now)).toEqual({ key: 'time.minutes', n: 5 });
    expect(ago(now - 3 * 3_600_000, now)).toEqual({ key: 'time.hours', n: 3 });
    expect(ago(now - 50 * 3_600_000, now)).toEqual({ key: 'time.days', n: 2 });
  });
});
