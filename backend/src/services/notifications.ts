import { desc, isNull, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { adminNotifications } from '../db/schema.js';
import { tr, type Language } from '../i18n/index.js';
import { createLogger } from '../logger.js';
import { DEFAULT_NOTIFICATIONS, NOTIFICATION_EVENTS, type NotificationEvent, type NotificationSettings, type SettingsService } from './settings.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('notifications');

/** Only Discord's own webhook addresses: the server never posts to any other address it is given. */
export const DISCORD_WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,120}$/;

/** Notifications older than this are removed; the list stays short on long-running servers. */
const KEEP_MS = 90 * 86_400_000;
const DISCORD_TIMEOUT_MS = 8000;

export type NotificationParams = Record<string, string | number>;

/** Title and text of each event, in English (the catalog in i18n/nl.ts translates them). */
export const MESSAGES: Record<NotificationEvent, { title: string; body: string }> = {
  cleanupPlanned: { title: 'Clean-up: {count} file(s) will be deleted on {date}', body: 'Rule "{rule}": {titles}. Keep a file on the clean-up page to stop this.' },
  cleanupDeleted: { title: 'Clean-up: {count} file(s) deleted', body: 'Rule "{rule}": {titles} ({size} freed).' },
  newMedia: { title: 'New in {library}: {count} file(s)', body: 'Found in the latest scan.' },
  scanFailed: { title: 'Scanning {library} failed', body: '{reason}' },
  backupFailed: { title: 'The scheduled backup failed', body: '{reason}' },
  newDevice: { title: 'New sign-in: {user} on {device}', body: 'If this was not expected, sign the device out under Users.' },
  storageLow: { title: 'Disk space is running low', body: '{disk}: {free} free.' },
};

export interface NotificationView {
  id: number;
  event: NotificationEvent;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
}

/** Normalises stored settings (older versions have none; new events default as in DEFAULT_NOTIFICATIONS). */
export function effectiveNotifications(stored: Partial<NotificationSettings> | undefined): NotificationSettings {
  return {
    events: { ...DEFAULT_NOTIFICATIONS.events, ...(stored?.events ?? {}) },
    discordWebhook: stored?.discordWebhook ?? '',
    discordLanguage: stored?.discordLanguage === 'nl' ? 'nl' : 'en',
  };
}

export function renderNotification(event: NotificationEvent, params: NotificationParams, lang: Language): { title: string; body: string } {
  const m = MESSAGES[event];
  return { title: tr(lang, m.title, params), body: tr(lang, m.body, params) };
}

/** "A, B, C and 4 more": titles for a message, never paths. */
export function titleList(titles: string[], lang: Language, max = 5): string {
  const unique = [...new Set(titles)];
  const shown = unique.slice(0, max).join(', ');
  return unique.length > max ? tr(lang, '{list} and {n} more', { list: shown, n: unique.length - max }) : shown;
}

/**
 * Messages for administrators only. Each enabled event is stored for the bell in the admin pages
 * and, when a Discord webhook is set (opt-in), posted there too. Sending never blocks or breaks the
 * work that caused it; a failed post is logged and the message stays in Vidalune.
 */
export class NotificationService {
  constructor(
    private readonly db: DB,
    private readonly settings: SettingsService,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  config(): NotificationSettings {
    return effectiveNotifications(this.settings.get().notifications);
  }

  notify(event: NotificationEvent, params: NotificationParams = {}): void {
    const cfg = this.config();
    if (!cfg.events[event]) return;
    try {
      this.db.insert(adminNotifications).values({ event, params: JSON.stringify(params) }).run();
      this.db.delete(adminNotifications).where(lt(adminNotifications.createdAt, Date.now() - KEEP_MS)).run();
    } catch (err) {
      log.warn(`Could not store a notification: ${(err as Error).message}`);
    }
    if (cfg.discordWebhook) void this.postDiscord(cfg.discordWebhook, renderNotification(event, params, cfg.discordLanguage)).catch(() => undefined);
  }

  /** Posts one message to Discord. Resolves with an error text (in `lang`) instead of throwing. */
  async postDiscord(url: string, message: { title: string; body: string }, lang: Language = 'en'): Promise<string | null> {
    if (!DISCORD_WEBHOOK.test(url)) return tr(lang, 'Not a Discord webhook address.');
    const content = `**${message.title}**\n${message.body}`.slice(0, 1900);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DISCORD_TIMEOUT_MS);
    try {
      // allowed_mentions: none — a title can never ping @everyone or anyone else.
      const res = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: ctrl.signal });
      if (!res.ok) {
        log.warn(`Discord answered ${res.status} to a notification`);
        return tr(lang, 'Discord answered {status}.', { status: res.status });
      }
      return null;
    } catch (err) {
      const reason = ctrl.signal.aborted ? tr(lang, 'no answer in time') : (err as Error).message;
      log.warn(`Could not post to Discord: ${reason}`);
      return tr(lang, 'Could not reach Discord: {reason}', { reason });
    } finally {
      clearTimeout(timer);
    }
  }

  list(lang: Language, limit = 50): { items: NotificationView[]; unread: number } {
    const rows = this.db.select().from(adminNotifications).orderBy(desc(adminNotifications.createdAt), desc(adminNotifications.id)).limit(limit).all();
    const items = rows
      .filter((r): r is typeof r & { event: NotificationEvent } => (NOTIFICATION_EVENTS as readonly string[]).includes(r.event))
      .map((r) => {
        let params: NotificationParams = {};
        try {
          params = JSON.parse(r.params) as NotificationParams;
        } catch {
          /* shown without details */
        }
        return { id: r.id, event: r.event, ...renderNotification(r.event, params, lang), createdAt: r.createdAt, read: r.readAt !== null };
      });
    return { items, unread: this.unread() };
  }

  unread(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(adminNotifications).where(isNull(adminNotifications.readAt)).get()!.n;
  }

  markAllRead(): void {
    this.db.update(adminNotifications).set({ readAt: Date.now() }).where(isNull(adminNotifications.readAt)).run();
  }
}
