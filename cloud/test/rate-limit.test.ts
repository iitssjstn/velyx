import { describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from '../src/app.js';

describe('counting attempts', () => {
  it('keeps counting one account however many other addresses ask', () => {
    const limiter = new RateLimiter(10, 60_000);
    for (let i = 0; i < 9; i++) limiter.check('login:justin@example.com', 1000);
    // Many addresses in between used to wipe every count.
    let refused = 0;
    for (let i = 0; i < 60_000; i++) {
      try {
        limiter.check(`login:addr-${i}`, 1000);
      } catch {
        refused++;
      }
    }
    // Full: new addresses wait instead of the counts being forgotten.
    expect(refused).toBeGreaterThan(0);
    limiter.check('login:justin@example.com', 1000);
    expect(() => limiter.check('login:justin@example.com', 1000)).toThrow(/Too many attempts/);
    // After the window it may try again.
    expect(() => limiter.check('login:justin@example.com', 62_000)).not.toThrow();
  });

  it('counts an IPv6 connection by its /64, and IPv4 by the address', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:db8:1:2:ffff:1:2:3'));
    expect(clientKey('2001:db8:1:2::1')).not.toBe(clientKey('2001:db8:1:3::1'));
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('203.0.113.7')).not.toBe(clientKey('203.0.113.8'));
  });
});
