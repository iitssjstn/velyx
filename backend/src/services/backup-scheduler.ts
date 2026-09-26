import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/client.js';
import type { SettingsService } from './settings.js';
import { createDatabaseSnapshot, listBackups, retainedBackups, timestamp, type BackupFile } from './backup.js';
import { createLogger } from '../logger.js';

const log = createLogger('backup');
const DAY = 24 * 60 * 60 * 1000;

/** The most recent moment at `hour`:00 local time that is not after `now`. */
export function lastSlot(now: Date, hour: number): Date {
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
  return slot;
}

/** Whether a scheduled backup should run now, given the newest automatic backup. */
export function backupDue(schedule: 'daily' | 'weekly' | 'off', hour: number, newestAuto: number | null, now: Date): boolean {
  if (schedule === 'off') return false;
  const slot = lastSlot(now, hour).getTime();
  if (schedule === 'daily') return newestAuto === null || newestAuto < slot;
  // Weekly: at the first slot at least a week (minus a little slack) after the previous backup.
  return newestAuto === null || (newestAuto < slot && now.getTime() - newestAuto >= 7 * DAY - 12 * 60 * 60 * 1000);
}

/**
 * Scheduled database backups with grandfather-father-son rotation. Only automatic backups are ever
 * rotated away; manual backups, full archives and safety copies are left alone. Checks run every
 * 15 minutes and cost nothing unless a backup is due.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DB,
    private readonly backupDir: string,
    private readonly settings: SettingsService,
    /** Returns a reason to skip (e.g. disk space critically low), or null. */
    private readonly skipReason: () => string | null = () => null,
  ) {}

  list(): BackupFile[] {
    return listBackups(this.backupDir);
  }

  /** A database snapshot named velyx-<kind>-<timestamp>.db. */
  create(kind: 'auto' | 'manual'): BackupFile {
    // Timestamps have one-second resolution; never overwrite a backup made in the same second.
    const stamp = timestamp();
    let name = `velyx-${kind}-${stamp}.db`;
    for (let n = 2; fs.existsSync(path.join(this.backupDir, name)); n++) name = `velyx-${kind}-${stamp}-${n}.db`;
    const file = createDatabaseSnapshot(this.db, this.backupDir, name);
    const st = fs.statSync(file);
    log.info(`${kind === 'auto' ? 'Scheduled' : 'Manual'} backup written to ${path.basename(file)}`);
    return { name, kind, size: st.size, createdAt: st.mtimeMs };
  }

  /** Deletes automatic backups the retention policy no longer needs. Returns the deleted names. */
  rotate(): string[] {
    const s = this.settings.get();
    const autos = this.list().filter((b) => b.kind === 'auto');
    const keep = retainedBackups(autos, { daily: s.backupKeepDaily, weekly: s.backupKeepWeekly, monthly: s.backupKeepMonthly });
    const removed: string[] = [];
    for (const b of autos) {
      if (keep.has(b.name)) continue;
      fs.rmSync(path.join(this.backupDir, b.name), { force: true });
      removed.push(b.name);
    }
    if (removed.length) log.info(`Removed ${removed.length} old automatic backup(s)`);
    return removed;
  }

  nextDue(now = new Date()): number | null {
    const s = this.settings.get();
    if (s.backupSchedule === 'off') return null;
    const newest = this.list().find((b) => b.kind === 'auto')?.createdAt ?? null;
    if (backupDue(s.backupSchedule, s.backupHour, newest, now)) return now.getTime();
    const next = lastSlot(now, s.backupHour);
    next.setDate(next.getDate() + 1);
    if (s.backupSchedule === 'weekly' && newest !== null) {
      while (next.getTime() - newest < 7 * DAY - 12 * 60 * 60 * 1000) next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  /** Runs a scheduled backup if one is due. Returns the created backup, if any. */
  tick(now = new Date()): BackupFile | null {
    if (this.running) return null;
    const s = this.settings.get();
    const newest = this.list().find((b) => b.kind === 'auto')?.createdAt ?? null;
    if (!backupDue(s.backupSchedule, s.backupHour, newest, now)) return null;
    const skip = this.skipReason();
    if (skip) {
      log.warn(`Scheduled backup skipped: ${skip}`);
      return null;
    }
    this.running = true;
    try {
      const created = this.create('auto');
      this.rotate();
      return created;
    } catch (err) {
      log.error('Scheduled backup failed', err);
      return null;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 15 * 60 * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
