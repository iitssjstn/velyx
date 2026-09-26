import crypto from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_COOKIE = 'velyx_session';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  avatarFile: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * The id shown in the UI and used to revoke a session. Derived from the stored hash (which is
 * derived from the token), so neither the token nor the stored key is ever sent to a browser.
 */
export function publicSessionId(storedId: string): string {
  return crypto.createHash('sha256').update(`velyx-session:${storedId}`).digest('hex').slice(0, 20);
}

/** "Firefox on Windows" style label from a User-Agent header. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|wget|python|okhttp/i.test(ua)
              ? 'Script'
              : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? `${browser} on ${os}` : browser;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string | null;
  device: string;
  ip: string | null;
  current: boolean;
}

export class SessionService {
  constructor(
    private readonly db: DB,
    private readonly ttlDays: number,
  ) {}

  get ttlMs(): number {
    return this.ttlDays * 24 * 60 * 60 * 1000;
  }

  create(userId: number, userAgent?: string, ip?: string): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.db
      .insert(sessions)
      .values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null, ip: ip?.slice(0, 64) ?? null })
      .run();
    return { token, expiresAt };
  }

  /** Active sessions of a user, newest activity first. */
  list(userId: number, currentToken?: string): SessionInfo[] {
    const current = currentToken ? hashToken(currentToken) : null;
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, Date.now())))
      .all()
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({
        id: publicSessionId(s.id),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        device: describeUserAgent(s.userAgent),
        ip: s.ip,
        current: s.id === current,
      }));
  }

  /** Ends one session of a user by its public id. Returns false when there is no such session. */
  revoke(userId: number, publicId: string): boolean {
    const rows = this.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
    const row = rows.find((r) => publicSessionId(r.id) === publicId);
    if (!row) return false;
    this.db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return true;
  }

  /** Resolves a token to an active, enabled user. Extends the session (sliding expiry) at most once per hour. */
  resolve(token: string | undefined, ip?: string): SessionUser | null {
    if (!token || token.length > 128) return null;
    const id = hashToken(token);
    const now = Date.now();
    const row = this.db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        avatarFile: users.avatarFile,
        disabled: users.disabled,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
      .get();
    if (!row || row.disabled) return null;
    if (now - row.lastSeenAt > 60 * 60 * 1000) {
      this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: now + this.ttlMs, ...(ip ? { ip: ip.slice(0, 64) } : {}) })
        .where(eq(sessions.id, id))
        .run();
    }
    return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, avatarFile: row.avatarFile };
  }

  destroy(token: string | undefined): void {
    if (!token) return;
    this.db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
  }

  /** Ends all sessions of a user except `exceptToken`'s. Returns how many were ended. */
  destroyAllForUser(userId: number, exceptToken?: string): number {
    const rows = this.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
    const keep = exceptToken ? hashToken(exceptToken) : null;
    let n = 0;
    for (const r of rows) {
      if (r.id !== keep) {
        this.db.delete(sessions).where(eq(sessions.id, r.id)).run();
        n++;
      }
    }
    return n;
  }

  purgeExpired(): number {
    return this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run().changes;
  }
}
