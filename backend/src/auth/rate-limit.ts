/**
 * Progressive sign-in throttling. After `freeAttempts` failures a key (a client address or an
 * account) must wait before trying again, and every further failure doubles the wait up to
 * `maxDelayMs`. There is no permanent lockout: failures are forgotten after `forgetAfterMs`
 * without new ones, and a successful sign-in clears the account and the address.
 */
export interface LimiterOptions {
  freeAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  forgetAfterMs?: number;
  maxKeys?: number;
}

interface Entry {
  failures: number;
  lastFailure: number;
  blockedUntil: number;
}

export class ProgressiveLimiter {
  private entries = new Map<string, Entry>();
  private readonly o: Required<LimiterOptions>;

  constructor(opts: LimiterOptions = {}, private readonly now: () => number = Date.now) {
    this.o = { freeAttempts: 5, baseDelayMs: 30_000, maxDelayMs: 15 * 60_000, forgetAfterMs: 60 * 60_000, maxKeys: 10_000, ...opts };
  }

  private entry(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (e && this.now() - e.lastFailure > this.o.forgetAfterMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  /** Milliseconds until any of the keys may try again (0 = allowed now). */
  retryAfter(keys: string[]): number {
    const now = this.now();
    return Math.max(0, ...keys.map((k) => (this.entry(k)?.blockedUntil ?? 0) - now));
  }

  /** Records a failed attempt; returns the new wait in ms for the most restricted key. */
  fail(keys: string[]): number {
    const now = this.now();
    if (this.entries.size > this.o.maxKeys) {
      // Drop the oldest half instead of growing without bound under a spray of addresses.
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastFailure - b[1].lastFailure).slice(0, this.entries.size / 2);
      for (const [k] of oldest) this.entries.delete(k);
    }
    for (const key of keys) {
      const e = this.entry(key) ?? { failures: 0, lastFailure: now, blockedUntil: 0 };
      e.failures++;
      e.lastFailure = now;
      const over = e.failures - this.o.freeAttempts;
      if (over >= 0) e.blockedUntil = now + Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** over);
      this.entries.set(key, e);
    }
    return this.retryAfter(keys);
  }

  reset(keys: string[]): void {
    for (const k of keys) this.entries.delete(k);
  }
}
