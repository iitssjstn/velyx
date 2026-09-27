import { eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { cleanupPlanned } from '../db/schema.js';
import { createLogger } from '../logger.js';
import type { AuditLog } from './audit.js';
import { cleanupCandidates, deleteFiles, effectiveRules, type CleanupCandidate } from './cleanup.js';
import type { NotificationService } from './notifications.js';
import { titleList } from './notifications.js';
import type { SettingsService } from './settings.js';

const log = createLogger('cleanup');
const DAY = 86_400_000;

export interface CleanupRunResult {
  planned: number;
  unplanned: number;
  deleted: number;
  failed: number;
}

const sizeText = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const dateText = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Carries out an administrator's own rules that plan deletions:
 *  - a file that starts matching such a rule is planned for `graceDays` later (administrators are
 *    notified, and anyone with admin access can keep it until then);
 *  - a plan is dropped when the file no longer matches (kept, watched again, rule changed or off);
 *  - on the day, the file is deleted only if deleting is allowed, it still matches, and nobody is
 *    watching it. Every deletion is in the audit log.
 * Nothing here runs unless such a rule exists.
 */
export class CleanupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      db: DB;
      settings: SettingsService;
      audit: AuditLog;
      notifications: NotificationService;
      /** Files someone is streaming right now. */
      playing: () => Set<number>;
      /** Rescan a library after files were deleted from it. */
      rescan: (libraryId: number) => void;
    },
  ) {}

  run(now = Date.now()): CleanupRunResult {
    const result: CleanupRunResult = { planned: 0, unplanned: 0, deleted: 0, failed: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      const { db, settings } = this.deps;
      const s = settings.get();
      const custom = s.cleanupCustomRules ?? [];
      const deleting = custom.filter((r) => r.enabled && r.action === 'delete');
      // No rule plans deletions: nothing to compute; plans of a rule that was turned off are dropped.
      if (!deleting.length) {
        result.unplanned = db.delete(cleanupPlanned).run().changes;
        return result;
      }
      const { candidates } = cleanupCandidates(db, effectiveRules(s.cleanupRules), now, 'en', custom);
      // Which deleting rule each candidate matches (the first one, in the administrator's order).
      const matchOf = new Map<number, { candidate: CleanupCandidate; ruleId: string }>();
      for (const c of candidates) {
        const rule = deleting.find((r) => c.reasons.some((x) => x.ruleId === r.id));
        if (rule) matchOf.set(c.fileId, { candidate: c, ruleId: rule.id });
      }

      // Drop plans that no longer hold (kept, changed file, rule gone, watched again).
      const plans = db.select().from(cleanupPlanned).all();
      const stale = plans.filter((p) => {
        const m = matchOf.get(p.mediaFileId);
        return !m || m.ruleId !== p.ruleId || m.candidate.size !== p.size;
      });
      if (stale.length) {
        db.delete(cleanupPlanned).where(inArray(cleanupPlanned.mediaFileId, stale.map((p) => p.mediaFileId))).run();
        result.unplanned = stale.length;
      }
      const current = new Map(plans.filter((p) => !stale.includes(p)).map((p) => [p.mediaFileId, p]));

      // New plans, notified once per rule.
      const fresh = new Map<string, CleanupCandidate[]>();
      for (const [fileId, m] of matchOf) {
        if (current.has(fileId)) continue;
        const rule = deleting.find((r) => r.id === m.ruleId)!;
        const dueAt = now + rule.graceDays * DAY;
        db.insert(cleanupPlanned).values({ mediaFileId: fileId, ruleId: rule.id, size: m.candidate.size, plannedAt: now, dueAt }).run();
        current.set(fileId, { mediaFileId: fileId, ruleId: rule.id, size: m.candidate.size, plannedAt: now, dueAt });
        fresh.set(rule.id, [...(fresh.get(rule.id) ?? []), m.candidate]);
        result.planned++;
      }
      for (const [ruleId, files] of fresh) {
        const rule = deleting.find((r) => r.id === ruleId)!;
        this.deps.notifications.notify('cleanupPlanned', { count: files.length, rule: rule.name, date: dateText(now + rule.graceDays * DAY), titles: titleList(files.map(label), s.notifications?.discordLanguage ?? 'en') });
      }

      // Due plans: delete (only while deleting is allowed; otherwise they wait).
      if (!s.cleanupDeletion) return result;
      const playing = this.deps.playing();
      const due = [...current.values()].filter((p) => p.dueAt <= now && !playing.has(p.mediaFileId));
      if (!due.length) return result;
      const candidateIds = new Set(candidates.map((c) => c.fileId));
      const deleted = new Map<string, { titles: string[]; bytes: number }>();
      for (const p of due) {
        const m = matchOf.get(p.mediaFileId)!;
        const [r] = deleteFiles(db, [p.mediaFileId], candidateIds);
        if (r?.ok) {
          const rule = deleting.find((x) => x.id === p.ruleId)!;
          this.deps.audit.record('cleanup.deleted', { actorName: `rule: ${rule.name}`.slice(0, 64), target: r.path, detail: `${sizeText(r.size)}, planned ${dateText(p.plannedAt)}` });
          db.delete(cleanupPlanned).where(eq(cleanupPlanned.mediaFileId, p.mediaFileId)).run();
          const d = deleted.get(rule.id) ?? { titles: [], bytes: 0 };
          d.titles.push(label(m.candidate));
          d.bytes += r.size;
          deleted.set(rule.id, d);
          result.deleted++;
          this.deps.rescan(r.libraryId!);
        } else {
          result.failed++;
          log.warn(`Planned clean-up of file ${p.mediaFileId} did not happen: ${r?.error ?? 'unknown reason'}`);
        }
      }
      for (const [ruleId, d] of deleted) {
        const rule = deleting.find((r) => r.id === ruleId)!;
        this.deps.notifications.notify('cleanupDeleted', { count: d.titles.length, rule: rule.name, titles: titleList(d.titles, s.notifications?.discordLanguage ?? 'en'), size: sizeText(d.bytes) });
      }
      return result;
    } catch (err) {
      log.error('Clean-up rules could not run', err);
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Checks every hour (and once shortly after start). */
  start(): void {
    if (this.timer) return;
    setTimeout(() => this.run(), 60_000).unref();
    this.timer = setInterval(() => this.run(), 60 * 60 * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const label = (c: CleanupCandidate) => (c.subtitle ? `${c.title} ${c.subtitle}` : c.title);
