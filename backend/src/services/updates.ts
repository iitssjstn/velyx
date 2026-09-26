import { APP_VERSION } from '../version.js';
import type { FetchLike } from './tmdb.js';
import { createLogger } from '../logger.js';

const log = createLogger('updates');
const DAY = 24 * 60 * 60 * 1000;

/** Compares "0.4.1" style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  checkedAt: number | null;
}

/**
 * Checks the project's version tags on GitHub at most once a day, only when an admin looks at the
 * dashboard. Sends nothing about the server; can be switched off in Admin → Server.
 */
export class UpdateChecker {
  private cached: UpdateInfo = { current: APP_VERSION, latest: null, available: false, url: null, checkedAt: null };
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly repo: string,
    private readonly enabled: () => boolean,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  /** Returns the last known result and refreshes it in the background when it is stale. */
  info(now = Date.now()): UpdateInfo {
    if (!this.enabled() || !this.repo) return { ...this.cached, available: false };
    if (!this.inflight && (!this.cached.checkedAt || now - this.cached.checkedAt > DAY)) {
      this.inflight = this.check(now).finally(() => (this.inflight = null));
    }
    return { ...this.cached };
  }

  async check(now = Date.now()): Promise<void> {
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/tags?per_page=30`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Velyx/${APP_VERSION}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const tags = (await res.json()) as { name: string }[];
      const versions = tags.map((t) => /^v?(\d+\.\d+\.\d+)$/.exec(t.name)?.[1]).filter((v): v is string => Boolean(v));
      const latest = versions.sort(compareVersions).at(-1) ?? null;
      this.cached = {
        current: APP_VERSION,
        latest,
        available: Boolean(latest && compareVersions(latest, APP_VERSION) > 0),
        url: latest ? `https://github.com/${this.repo}/releases/tag/v${latest}` : null,
        checkedAt: now,
      };
    } catch (err) {
      // Try again tomorrow; being offline is normal for some servers.
      this.cached = { ...this.cached, checkedAt: now };
      log.debug(`Update check failed: ${(err as Error).message}`);
    }
  }
}
