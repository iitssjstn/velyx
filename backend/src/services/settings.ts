import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { AppConfig } from '../config.js';

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
}

const DEFAULTS: ServerSettings = {
  serverName: 'Velyx',
  serverUrl: '',
  tmdbApiKey: '',
  tmdbLanguage: '',
  includeAdult: false,
  watchFolders: true,
  collectionsBackfilled: false,
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

  serverUrl(): string {
    return this.load().serverUrl || this.config.serverUrl;
  }
}
