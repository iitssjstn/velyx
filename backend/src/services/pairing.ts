import crypto from 'node:crypto';

/** How long a code shown by the app stays valid. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** How often the app may ask whether the code was confirmed. */
export const PAIRING_POLL_SECONDS = 3;
/** Unconfirmed codes kept at once; beyond this the oldest go first. */
const MAX_PENDING = 500;
/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface Pairing {
  code: string;
  /** Secret the app polls with; only the app that asked for the code knows it. */
  pollToken: string;
  deviceName: string;
  createdAt: number;
  expiresAt: number;
  /** Set once someone signed in confirms the code on the website. */
  userId: number | null;
}

/** "ABC-DEF" → "ABCDEF"; anything that cannot be a code → null. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 6 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * Connecting the Velyx app with a code, like signing in to a TV: the app shows a short code, someone
 * who is signed in on the website enters it, and the app is signed in to that account. Codes live
 * only in memory for ten minutes and work once; a restart simply means asking for a new code.
 */
export class PairingService {
  private pending = new Map<string, Pairing>();

  start(deviceName: string, now = Date.now()): { code: string; pollToken: string; expiresAt: number } {
    this.prune(now);
    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.values()].sort((a, b) => a.createdAt - b.createdAt)[0]!;
      this.pending.delete(oldest.code);
    }
    let code: string;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
    } while (this.pending.has(code));
    const pairing: Pairing = { code, pollToken: crypto.randomBytes(24).toString('base64url'), deviceName, createdAt: now, expiresAt: now + PAIRING_TTL_MS, userId: null };
    this.pending.set(code, pairing);
    return { code: formatCode(code), pollToken: pairing.pollToken, expiresAt: pairing.expiresAt };
  }

  /** The device waiting behind a code (still unconfirmed), or null. */
  find(input: string, now = Date.now()): { code: string; deviceName: string; expiresAt: number } | null {
    const code = normalizeCode(input);
    const p = code ? this.pending.get(code) : undefined;
    if (!p || p.expiresAt <= now || p.userId !== null) return null;
    return { code: formatCode(p.code), deviceName: p.deviceName, expiresAt: p.expiresAt };
  }

  /** Confirms a code for this account. Returns the device name, or null for an unknown or used code. */
  approve(input: string, userId: number, now = Date.now()): string | null {
    const code = normalizeCode(input);
    const p = code ? this.pending.get(code) : undefined;
    if (!p || p.expiresAt <= now || p.userId !== null) return null;
    p.userId = userId;
    return p.deviceName;
  }

  /**
   * What the app learns when it asks: still waiting, confirmed (for which account and device —
   * the code is used up then), or gone (expired, unknown).
   */
  poll(pollToken: string, now = Date.now()): { status: 'pending' } | { status: 'approved'; userId: number; deviceName: string } | { status: 'expired' } {
    const p = [...this.pending.values()].find((x) => safeEqual(x.pollToken, pollToken));
    if (!p || p.expiresAt <= now) return { status: 'expired' };
    if (p.userId === null) return { status: 'pending' };
    this.pending.delete(p.code);
    return { status: 'approved', userId: p.userId, deviceName: p.deviceName };
  }

  get size(): number {
    return this.pending.size;
  }

  private prune(now: number): void {
    for (const [k, p] of this.pending) if (p.expiresAt <= now) this.pending.delete(k);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
