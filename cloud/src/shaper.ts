/** A server counts as busy (sharing the relay) while it sent something this recently. */
const ACTIVE_MS = 2000;
/** How far ahead of its rate a server may run (a quarter of a second's worth). */
const BURST_S = 0.25;

/**
 * Shares the relay's bandwidth fairly: every server that is sending gets an equal part of the total,
 * and never more than its own limit. The relay passes credit back to a server (the tunnel's window)
 * only as fast as this allows, so a busy server slows down instead of crowding out the others.
 */
export class Shaper {
  private readonly buckets = new Map<string, { tokens: number; at: number; lastUse: number }>();

  constructor(
    private readonly opts: {
      /** Total bytes per second for everyone (0: no limit). */
      totalBps: () => number;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** Servers sending right now. */
  active(): number {
    const now = this.now();
    let n = 0;
    for (const b of this.buckets.values()) if (now - b.lastUse < ACTIVE_MS) n++;
    return n;
  }

  /** Bytes per second a server may send now (Infinity: no limit); `capBps` 0 is no limit of its own. */
  rate(serverId: string, capBps: number): number {
    const total = this.opts.totalBps();
    const busy = Math.max(1, this.active() + (this.isActive(serverId) ? 0 : 1));
    const share = total > 0 ? total / busy : Infinity;
    return Math.min(share, capBps > 0 ? capBps : Infinity);
  }

  private isActive(serverId: string) {
    const b = this.buckets.get(serverId);
    return !!b && this.now() - b.lastUse < ACTIVE_MS;
  }

  /** How long (ms) before a server that just sent `bytes` more may be given credit for them. */
  delay(serverId: string, bytes: number, capBps: number): number {
    const rate = this.rate(serverId, capBps);
    const now = this.now();
    let b = this.buckets.get(serverId);
    if (!b) {
      // A server that starts sending may use its burst at once.
      b = { tokens: Number.isFinite(rate) ? rate * BURST_S : 0, at: now, lastUse: now };
      this.buckets.set(serverId, b);
    }
    b.lastUse = now;
    if (!Number.isFinite(rate)) {
      b.tokens = 0;
      b.at = now;
      return 0;
    }
    b.tokens = Math.min(rate * BURST_S, b.tokens + ((now - b.at) / 1000) * rate) - bytes;
    b.at = now;
    return b.tokens >= 0 ? 0 : Math.ceil((-b.tokens / rate) * 1000);
  }

  forget(serverId: string): void {
    this.buckets.delete(serverId);
  }
}

export const mbpsToBps = (mbps: number) => (mbps * 1_000_000) / 8;
