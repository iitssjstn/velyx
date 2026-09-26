import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('audit');

export type AuditAction =
  | 'login.success'
  | 'login.failed'
  | 'login.blocked'
  | 'logout'
  | 'setup.completed'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.password_reset'
  | 'account.password_changed'
  | 'session.revoked'
  | 'session.revoked_all'
  | 'library.created'
  | 'library.updated'
  | 'library.deleted'
  | 'library.scan'
  | 'scans.paused'
  | 'scans.resumed'
  | 'metadata.matched'
  | 'metadata.refreshed'
  | 'settings.updated'
  | 'tmdb.updated'
  | 'backup.created'
  | 'backup.downloaded'
  | 'backup.deleted'
  | 'database.restored'
  | 'cache.cleared'
  | 'collection.created'
  | 'collection.deleted'
  | 'segments.edited'
  | 'segments.reset'
  | 'segments.analyze'
  | 'cleanup.settings'
  | 'cleanup.kept'
  | 'cleanup.deleted'
  | 'subtitles.settings'
  | 'subtitles.downloaded'
  | 'subtitles.removed';

export interface AuditActor {
  id: number;
  username: string;
}

/** Entries older than this are pruned; the table stays small on long-running servers. */
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;

export class AuditLog {
  private writes = 0;

  constructor(private readonly db: DB) {}

  record(action: AuditAction, opts: { actor?: AuditActor | null; actorName?: string | null; target?: string | null; detail?: string | null; ip?: string | null } = {}): void {
    try {
      this.db
        .insert(auditLog)
        .values({
          action,
          actorId: opts.actor?.id ?? null,
          actorName: opts.actor?.username ?? opts.actorName?.slice(0, 64) ?? null,
          target: opts.target?.slice(0, 200) ?? null,
          detail: opts.detail?.slice(0, 500) ?? null,
          ip: opts.ip ?? null,
        })
        .run();
      if (++this.writes % 200 === 0) this.prune();
    } catch (err) {
      // Auditing must never break the action itself.
      log.warn(`Could not write audit entry ${action}`, err);
    }
  }

  prune(now = Date.now()): void {
    this.db.delete(auditLog).where(lt(auditLog.at, now - RETENTION_MS)).run();
    const cutoff = this.db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.id)).limit(1).offset(MAX_ENTRIES).get();
    if (cutoff) this.db.delete(auditLog).where(sql`${auditLog.id} <= ${cutoff.id}`).run();
  }

  list(opts: { page: number; limit: number; action?: string; actorId?: number }) {
    const conds: SQL[] = [];
    if (opts.action) conds.push(opts.action.endsWith('.') ? sql`${auditLog.action} LIKE ${opts.action + '%'}` : eq(auditLog.action, opts.action));
    if (opts.actorId) conds.push(eq(auditLog.actorId, opts.actorId));
    const where = conds.length ? and(...conds) : undefined;
    const total = this.db.select({ n: sql<number>`count(*)` }).from(auditLog).where(where).get()!.n;
    const items = this.db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit)
      .all();
    return { items, total, page: opts.page, pageSize: opts.limit };
  }
}
