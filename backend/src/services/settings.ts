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
  /** Look for new Velyx versions (GitHub tags) at most once a day. */
  updateCheck: boolean;
  /** Minutes between scheduled scans (0 = off); null = SCAN_INTERVAL_MINUTES from the environment. */
  scanIntervalMinutes: number | null;
  /** Look for new and changed files shortly after Velyx starts. */
  scanOnStartup: boolean;
  /** Scheduled scans wait while someone is watching (up to a few hours). */
  deferScansWhilePlaying: boolean;
  /** Look for intros and credits in the background (audio only, never while someone watches). */
  segmentDetection: boolean;
  /** Also recognise end credits in the picture (keyframes of the last minutes, low resolution). */
  segmentVideo: boolean;
  cleanupRules: CleanupRules;
  /** Library clean-up may delete files (off by default; the library must also be mounted writable). */
  cleanupDeletion: boolean;
  /** OpenSubtitles.com API key; empty = searching subtitles online is off. */
  openSubtitlesApiKey: string;
  /** Optional OpenSubtitles account (more downloads per day than without one). */
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
}

const DEFAULTS: ServerSettings = {
  serverName: 'Velyx',
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
  cleanupRules: DEFAULT_CLEANUP_RULES,
  cleanupDeletion: false,
  openSubtitlesApiKey: '',
  openSubtitlesUsername: '',
  openSubtitlesPassword: '',
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
    return this.load().serverName || 'Velyx';
  }

  /** Effective minutes between scheduled scans: the admin setting, else the environment. */
  scanIntervalMinutes(): number {
    return this.load().scanIntervalMinutes ?? this.config.scanIntervalMinutes;
  }

  serverUrl(): string {
    return this.load().serverUrl || this.config.serverUrl;
  }
}
