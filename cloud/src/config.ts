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
  /** Relay addresses are <slug>.<relayDomain> (default: the host of PUBLIC_URL). */
  relayDomain: string;
  /** Accounts that may use the admin page (/admin); they always have remote access themselves. */
  adminEmails: string[];
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<CloudConfig> = {}): CloudConfig {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const defaultWeb = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
  const publicUrl = (env.PUBLIC_URL ?? 'https://vidalune.com').replace(/\/+$/, '');
  return {
    adminEmails: (env.ADMIN_EMAILS ?? '')
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
    webDir: fs.existsSync(defaultWeb) ? defaultWeb : null,
    ...overrides,
  };
}
