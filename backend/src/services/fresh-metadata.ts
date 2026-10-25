import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { movies, shows } from '../db/schema.js';
import { createLogger } from '../logger.js';
import type { MetadataService } from './metadata.js';

const log = createLogger('fresh-metadata');

/**
 * Opened within this long after its last refresh, a title gets the stored metadata (no TMDB request):
 * only someone opening it this very minute, or a page asking again while it waits for the refresh.
 * Everyone else gets it fetched anew, so the page always shows what TMDB has now.
 */
export const FRESH_FOR_MS = 60_000;
/** After a failed refresh a title is not asked for again for this long (TMDB is probably unreachable). */
export const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
/** How long a request waits for the refresh; after that it answers "pending" and the refresh goes on. */
const WAIT_MS = 8_000;

export type FreshKind = 'movie' | 'show';
/**
 * fresh: refreshed less than a minute ago, nothing done. refreshed: new metadata is stored (`id` is the
 * item that holds it). pending: still busy, ask again. skipped: cannot be refreshed now (no TMDB key,
 * not matched, or TMDB failed less than ten minutes ago).
 */
export type FreshResult = { status: 'fresh' | 'pending' | 'skipped' } | { status: 'refreshed'; id: number };

type Row = { tmdbId: number; status: 'matched' | 'manual'; confidence: number };

/**
 * Fresh metadata when someone opens a movie or show: fetched anew from TMDB every time (unless it was
 * refreshed less than a minute ago). People opening it at the same moment share one refresh.
 */
export class FreshMetadata {
  private readonly running = new Map<string, Promise<FreshResult>>();
  /** When the last refresh failed, per title: an unreachable TMDB is not asked again on every click. */
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly db: DB,
    private readonly metadata: MetadataService,
    private readonly opts: { now?: () => number; waitMs?: number } = {},
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async refresh(kind: FreshKind, id: number): Promise<FreshResult> {
    const key = `${kind}:${id}`;
    let job = this.running.get(key);
    if (!job) {
      const row = this.due(kind, id, key);
      if (typeof row === 'string') return { status: row };
      job = this.run(kind, id, key, row).finally(() => this.running.delete(key));
      this.running.set(key, job);
    }
    let timer: NodeJS.Timeout | undefined;
    const pending = new Promise<FreshResult>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'pending' }), this.opts.waitMs ?? WAIT_MS);
    });
    try {
      return await Promise.race([job, pending]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The title's match when it is due for a refresh, otherwise why not. */
  private due(kind: FreshKind, id: number, key: string): Row | 'fresh' | 'skipped' {
    if (!this.metadata.enabled) return 'skipped';
    const table = kind === 'movie' ? movies : shows;
    const r = this.db
      .select({ tmdbId: table.tmdbId, status: table.matchStatus, confidence: table.matchConfidence, updatedAt: table.metadataUpdatedAt })
      .from(table)
      .where(eq(table.id, id))
      .get();
    if (!r?.tmdbId || (r.status !== 'matched' && r.status !== 'manual')) return 'skipped';
    const now = this.now();
    if (r.updatedAt !== null && now - r.updatedAt < FRESH_FOR_MS) return 'fresh';
    const failed = this.failedAt.get(key);
    if (failed !== undefined && now - failed < RETRY_AFTER_FAILURE_MS) return 'skipped';
    return { tmdbId: r.tmdbId, status: r.status, confidence: r.confidence ?? 1 };
  }

  private async run(kind: FreshKind, id: number, key: string, row: Row): Promise<FreshResult> {
    try {
      if (kind === 'movie') return { status: 'refreshed', id: await this.metadata.applyMovie(id, row.tmdbId, row.status, row.confidence) };
      await this.metadata.applyShow(id, row.tmdbId, row.status, row.confidence);
      return { status: 'refreshed', id };
    } catch (err) {
      // The stored metadata stays as it is.
      log.warn(`Could not refresh the metadata of ${kind} ${id}`, err);
      if (this.failedAt.size >= 1000) this.failedAt.clear();
      this.failedAt.set(key, this.now());
      return { status: 'skipped' };
    }
  }
}
