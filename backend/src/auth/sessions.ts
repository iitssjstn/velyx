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

export class SessionService {
  constructor(
    private readonly db: DB,
    private readonly ttlDays: number,
  ) {}

  get ttlMs(): number {
    return this.ttlDays * 24 * 60 * 60 * 1000;
  }

  create(userId: number, userAgent?: string): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.db
      .insert(sessions)
      .values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null })
      .run();
    return { token, expiresAt };
  }

  /** Resolves a token to an active, enabled user. Extends the session (sliding expiry) at most once per hour. */
  resolve(token: string | undefined): SessionUser | null {
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
        .set({ lastSeenAt: now, expiresAt: now + this.ttlMs })
        .where(eq(sessions.id, id))
        .run();
    }
    return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, avatarFile: row.avatarFile };
  }

  destroy(token: string | undefined): void {
    if (!token) return;
    this.db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
  }

  destroyAllForUser(userId: number, exceptToken?: string): void {
    const rows = this.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
    const keep = exceptToken ? hashToken(exceptToken) : null;
    for (const r of rows) {
      if (r.id !== keep) this.db.delete(sessions).where(eq(sessions.id, r.id)).run();
    }
  }

  purgeExpired(): number {
    return this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run().changes;
  }
}
