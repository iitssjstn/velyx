import { DEFAULT_TRANSCODING, type TranscodingSettings } from '../playback/transcode.js';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { AppConfig } from '../config.js';

/** Which files the library clean-up suggests. Rules only suggest: nothing is deleted without review. */
export interface CleanupRules {
  /** Added more than `days` ago and never started by anyone. */
  unwatched: { enabled: boolean; days: number };
  /** Watched before, but nobody has played it for `days`. */
  stale: { enabled: boolean; days: number };
  /** Files larger than `gb` gigabytes. */
  large: { enabled: boolean; gb: number };
  /** Lower-quality extra versions of a movie or episode. */
  duplicates: { enabled: boolean };
  /** Unidentified titles and unreadable files. */
  missingInfo: { enabled: boolean };
}

export const DEFAULT_CLEANUP_RULES: CleanupRules = {
  unwatched: { enabled: true, days: 365 },
  stale: { enabled: false, days: 730 },
  large: { enabled: true, gb: 50 },
  duplicates: { enabled: true },
  missingInfo: { enabled: true },
};

/**
 * An administrator's own clean-up rule. Every condition that is set must hold (AND). A rule only
 * suggests, unless `action` is 'delete': then matching files are planned for deletion `graceDays`
 * later (they can be kept until then), and deleted only while the clean-up's "Allow deleting" is on.
 */
export interface CustomCleanupRule {
  id: string;
  name: string;
  enabled: boolean;
  /** null = every library. */
  libraryId: number | null;
  kind: 'all' | 'movie' | 'episode';
  /** 'nobody' = never started; 'someone' = finished by at least one user; 'everyone' = finished by every user who can see it. */
  watched: 'any' | 'nobody' | 'someone' | 'everyone';
  /** Added at least this many days ago. */
  addedDays: number | null;
  /** Nobody played it for at least this many days (a file never played counts from when it was added). */
  notPlayedDays: number | null;
  /** Larger than this many gigabytes. */
  minGb: number | null;
  action: 'suggest' | 'delete';
  graceDays: number;
}

export const NOTIFICATION_EVENTS = ['cleanupPlanned', 'cleanupDeleted', 'newMedia', 'scanFailed', 'backupFailed', 'newDevice', 'storageLow', 'inviteAccepted'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Messages for administrators: which events, and optionally a Discord channel (a webhook URL). */
export interface NotificationSettings {
  events: Record<NotificationEvent, boolean>;
  /** Discord webhook URL; empty = off. Only titles and reasons are sent, never paths or tokens. */
  discordWebhook: string;
  /** Language of the Discord messages (that of the administrator who set it up). */
  discordLanguage: 'en' | 'nl';
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  events: { cleanupPlanned: true, cleanupDeleted: true, newMedia: false, scanFailed: true, backupFailed: true, newDevice: false, storageLow: true, inviteAccepted: true },
  discordWebhook: '',
  discordLanguage: 'en',
};

/** This server's registration with the Vidalune account service (only while linking is on). */
export interface CloudLink {
  serverId: string;
  /** Proves to the account service that requests come from this server. */
  secret: string;
  /** The account it is linked to (email), as the service last reported. */
  account: string | null;
  /** Reachable through the Vidalune relay (opt-in, only while linked). */
  relay?: boolean;
  /** Its relay address (https://<name>.vidalune.com). */
  relayUrl?: string | null;
  /** The owner's Vidalune account has remote access (false: the relay needs a subscription). */
  relayAllowed?: boolean;
  /** The relay may connect: the owner, or someone who uses this server, has remote access. */
  relayUsable?: boolean;
  /** Users here (their ids) whose own Vidalune account has remote access (a viewer subscription). */
  remoteUsers?: string[];
  /** When the account service last said so (remote access keeps working a while when it cannot be reached). */
  remoteConfirmedAt?: number;
}

export interface ServerSettings {
  serverName: string;
  serverUrl: string;
  tmdbApiKey: string;
  tmdbLanguage: string;
  /** Include adult titles in TMDB searches. */
  includeAdult: boolean;
  /** Watch library folders and scan automatically when files change. */
  watchFolders: boolean;
  /** Internal: TMDB collections were looked up once for movies matched before collections existed. */
  collectionsBackfilled: boolean;
  /** Automatic database backups. */
  backupSchedule: 'daily' | 'weekly' | 'off';
  /** Local hour (0–23) after which the scheduled backup runs. */
  backupHour: number;
  backupKeepDaily: number;
  backupKeepWeekly: number;
  backupKeepMonthly: number;
  /** Look for new Vidalune versions (vidalune.com) at most once a day. */
  updateCheck: boolean;
  /** Minutes between scheduled scans (0 = off); null = SCAN_INTERVAL_MINUTES from the environment. */
  scanIntervalMinutes: number | null;
  /** Look for new and changed files shortly after Vidalune starts. */
  scanOnStartup: boolean;
  /** Scheduled scans wait while someone is watching (up to a few hours). */
  deferScansWhilePlaying: boolean;
  /** Look for intros and credits in the background (audio only; it waits while a scan runs or while people watch on a busy machine). */
  segmentDetection: boolean;
  /** Also recognise end credits in the picture (keyframes of the last minutes, low resolution). */
  segmentVideo: boolean;
  /**
   * Shared detection with other Vidalune servers through vidalune.com (off by default): timings
   * and fingerprints of recaps, intros and credits, by TMDB show, season and episode.
   */
  sharedDetection: boolean;
  cleanupRules: CleanupRules;
  /** Library clean-up may delete files (off by default; the library must also be mounted writable). */
  cleanupDeletion: boolean;
  /** An administrator's own clean-up rules (on top of the built-in ones). */
  cleanupCustomRules: CustomCleanupRule[];
  notifications: NotificationSettings;
  /** OpenSubtitles.com API key; empty = searching subtitles online is off. */
  openSubtitlesApiKey: string;
  /** Optional OpenSubtitles account (more downloads per day than without one). */
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
  /** Linked to a Vidalune account (opt-in; null: never contacts the account service). */
  cloud: CloudLink | null;
  /** Networks that also count as home ("100.64.0.0/10"), on top of the private ranges. */
  homeNetworks: string[];
  /** Open a port on the router with UPnP (opt-in), and which one outside. */
  upnp: { enabled: boolean; externalPort: number };
  /** Seerr (optional): its address and API key; empty = not used. The key never leaves the server. */
  seerr: { url: string; apiKey: string };
  /** Sonarr/Radarr (optional): their API keys never leave the server. */
  sonarr: { url: string; apiKey: string };
  radarr: { url: string; apiKey: string };
  /** Converting video the device cannot play (opt-in). */
  transcoding: TranscodingSettings;
}

const DEFAULTS: ServerSettings = {
  serverName: 'Vidalune',
  serverUrl: '',
  tmdbApiKey: '',
  tmdbLanguage: '',
  includeAdult: false,
  watchFolders: true,
  collectionsBackfilled: false,
  backupSchedule: 'daily',
  backupHour: 3,
  backupKeepDaily: 7,
  backupKeepWeekly: 4,
  backupKeepMonthly: 3,
  updateCheck: true,
  scanIntervalMinutes: null,
  scanOnStartup: false,
  deferScansWhilePlaying: true,
  segmentDetection: true,
  segmentVideo: true,
  sharedDetection: false,
  cleanupRules: DEFAULT_CLEANUP_RULES,
  cleanupDeletion: false,
  cleanupCustomRules: [],
  notifications: DEFAULT_NOTIFICATIONS,
  openSubtitlesApiKey: '',
  openSubtitlesUsername: '',
  openSubtitlesPassword: '',
  cloud: null,
  homeNetworks: [],
  upnp: { enabled: false, externalPort: 3000 },
  seerr: { url: '', apiKey: '' },
  sonarr: { url: '', apiKey: '' },
  radarr: { url: '', apiKey: '' },
  transcoding: DEFAULT_TRANSCODING,
};

export class SettingsService {
  private cache: ServerSettings | null = null;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
  ) {}

  private load(): ServerSettings {
    if (this.cache) return this.cache;
    const rows = this.db.select().from(settings).all();
    const result: ServerSettings = { ...DEFAULTS };
    for (const row of rows) {
      if (row.key in result) {
        try {
          (result as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
        } catch {
          /* ignore corrupt value, keep default */
        }
      }
    }
    // The default name before the rename: a server nobody named shows the new name.
    if (result.serverName === 'Velyx') result.serverName = DEFAULTS.serverName;
    this.cache = result;
    return result;
  }

  get(): ServerSettings {
    return { ...this.load() };
  }

  update(patch: Partial<ServerSettings>): ServerSettings {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      const json = JSON.stringify(value);
      this.db
        .insert(settings)
        .values({ key, value: json })
        .onConflictDoUpdate({ target: settings.key, set: { value: json } })
        .run();
    }
    this.cache = null;
    return this.get();
  }

  delete(key: keyof ServerSettings): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
    this.cache = null;
  }

  /** Effective TMDB key: the one saved in the admin UI wins, otherwise the environment variable. */
  tmdbKey(): string {
    return this.load().tmdbApiKey || this.config.tmdbApiKey;
  }

  tmdbKeySource(): 'settings' | 'environment' | 'none' {
    if (this.load().tmdbApiKey) return 'settings';
    if (this.config.tmdbApiKey) return 'environment';
    return 'none';
  }

  tmdbLanguage(): string {
    return this.load().tmdbLanguage || this.config.tmdbLanguage;
  }

  serverName(): string {
    return this.load().serverName || 'Vidalune';
  }

  /** Effective minutes between scheduled scans: the admin setting, else the environment. */
  scanIntervalMinutes(): number {
    return this.load().scanIntervalMinutes ?? this.config.scanIntervalMinutes;
  }

  serverUrl(): string {
    return this.load().serverUrl || this.config.serverUrl;
  }
}
