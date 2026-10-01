import fs from 'node:fs';
import path from 'node:path';

/** Settings of the Vidalune account service, from the environment. */
export interface CloudConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  /** Where people open the service, e.g. https://vidalune.com (links in answers, origin checks). */
  publicUrl: string;
  /** Number of proxies in front (Nginx Proxy Manager: 1). */
  trustProxy: number;
  /** Serve the account pages from this folder (null: API only). */
  webDir: string | null;
  /** The Vidalune web interface (frontend/dist) that app.<domain> serves (null: not served). */
  frontendDir: string | null;
  /** The Android app to hand out (vidalune-<version>.apk files; built into the image). */
  downloadDir: string;
  /** Relay addresses are <slug>.<relayDomain> (default: the host of PUBLIC_URL). */
  relayDomain: string;
  /** Accounts that may use the admin page (/admin); they always have remote access themselves. */
  adminEmails: string[];
  /** Who may open the CEO panel (/ceo): customers, access, relays and growth. Separate from administrators. */
  ceoEmails: string[];
  /** What the relay may send in total, in Mbit/s (shared fairly between servers; 0: no limit). */
  relayMaxMbps: number;
  /** What one server may send through the relay, in Mbit/s, unless set per server (0: no limit). */
  relayServerMbps: number;
  /** The OpenSubtitles key (and account) linked servers search and download subtitles with (null: not offered). */
  openSubtitles: { apiKey: string; username: string; password: string } | null;
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<CloudConfig> = {}): CloudConfig {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const defaultWeb = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
  const defaultFrontend = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'frontend', 'dist');
  const frontendDir = env.FRONTEND_DIR ? path.resolve(env.FRONTEND_DIR) : defaultFrontend;
  const publicUrl = (env.PUBLIC_URL ?? 'https://vidalune.com').replace(/\/+$/, '');
  return {
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    ceoEmails: (env.CEO_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    relayDomain: (env.RELAY_DOMAIN || new URL(publicUrl).hostname).toLowerCase(),
    port: int(env.PORT, 3100),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbPath: path.join(dataDir, 'cloud.db'),
    publicUrl,
    trustProxy: Math.max(0, int(env.TRUST_PROXY, 1)),
    relayMaxMbps: Math.max(0, int(env.RELAY_MAX_MBPS, 900)),
    relayServerMbps: Math.max(0, int(env.RELAY_SERVER_MBPS, 0)),
    openSubtitles: env.OPENSUBTITLES_API_KEY?.trim()
      ? { apiKey: env.OPENSUBTITLES_API_KEY.trim(), username: env.OPENSUBTITLES_USERNAME?.trim() ?? '', password: env.OPENSUBTITLES_PASSWORD ?? '' }
      : null,
    webDir: fs.existsSync(defaultWeb) ? defaultWeb : null,
    downloadDir: path.resolve(env.DOWNLOAD_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'downloads')),
    frontendDir: fs.existsSync(path.join(frontendDir, 'index.html')) ? frontendDir : null,
    ...overrides,
  };
}
