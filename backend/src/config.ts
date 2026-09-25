import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  cacheDir: string;
  imageCacheDir: string;
  subtitleCacheDir: string;
  avatarDir: string;
  backupDir: string;
  /** Absolute directories inside which libraries may be created. */
  mediaRoots: string[];
  tmdbApiKey: string;
  tmdbLanguage: string;
  sessionSecret: string;
  sessionTtlDays: number;
  cookieSecure: 'auto' | boolean;
  trustProxy: boolean;
  scanIntervalMinutes: number;
  ffprobePath: string;
  ffmpegPath: string;
  frontendDir: string | null;
  serverUrl: string;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The session secret is used to sign cookies. When SESSION_SECRET is not provided we generate
 * one once and persist it inside the data directory so sessions survive restarts.
 */
function resolveSessionSecret(dataDir: string, fromEnv: string | undefined): string {
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const file = path.join(dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* generate below */
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  const cacheDir = path.join(dataDir, 'cache');
  for (const dir of [dataDir, cacheDir, path.join(cacheDir, 'images'), path.join(cacheDir, 'subtitles'), path.join(dataDir, 'avatars'), path.join(dataDir, 'backups')]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const cookieSecureRaw = (env.COOKIE_SECURE ?? 'auto').toLowerCase();
  // Default: the monorepo layout (backend/dist or backend/src → ../../frontend/dist).
  const frontendCandidate = env.FRONTEND_DIR
    ? path.resolve(env.FRONTEND_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');

  const cfg: AppConfig = {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbPath: path.join(dataDir, 'velyx.db'),
    cacheDir,
    imageCacheDir: path.join(cacheDir, 'images'),
    subtitleCacheDir: path.join(cacheDir, 'subtitles'),
    avatarDir: path.join(dataDir, 'avatars'),
    backupDir: path.join(dataDir, 'backups'),
    mediaRoots: (env.MEDIA_ROOTS ?? '/media')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p)),
    tmdbApiKey: (env.TMDB_API_KEY ?? '').trim(),
    tmdbLanguage: env.TMDB_LANGUAGE?.trim() || 'en-US',
    sessionSecret: '',
    sessionTtlDays: int(env.SESSION_TTL_DAYS, 30),
    cookieSecure: cookieSecureRaw === 'auto' ? 'auto' : bool(cookieSecureRaw, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    scanIntervalMinutes: int(env.SCAN_INTERVAL_MINUTES, 360),
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    frontendDir: frontendCandidate,
    serverUrl: env.SERVER_URL ?? '',
    ...overrides,
  };
  cfg.sessionSecret = overrides.sessionSecret ?? resolveSessionSecret(dataDir, env.SESSION_SECRET);
  return cfg;
}
