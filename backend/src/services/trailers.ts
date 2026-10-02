import { FRESH_FOR_MS } from './fresh-metadata.js';
import type { SeerrService } from './seerr.js';
import type { TmdbClient, TmdbTrailer } from './tmdb.js';

/**
 * Trailers, looked up when a detail page asks: at TMDB, or (titles outside the library, no TMDB key)
 * through Seerr. Kept an hour like the rest of a page's metadata; never stored with the item.
 */
export class TrailerLookup {
  private readonly cache = new Map<string, { at: number; trailer: TmdbTrailer | null }>();

  constructor(
    private readonly tmdb: TmdbClient,
    private readonly seerr: SeerrService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** `viaSeerr`: a title outside the library may also be looked up through Seerr. */
  async get(kind: 'movie' | 'tv', tmdbId: number | null, opts: { viaSeerr?: boolean } = {}): Promise<{ trailer: TmdbTrailer | null }> {
    if (!tmdbId) return { trailer: null };
    const source = this.tmdb.configured ? 'tmdb' : opts.viaSeerr && this.seerr.configured() ? 'seerr' : null;
    if (!source) return { trailer: null };
    const key = `${source}:${kind}:${tmdbId}:${this.tmdb.language()}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < FRESH_FOR_MS) return { trailer: hit.trailer };
    try {
      const trailer = source === 'tmdb' ? await this.tmdb.trailer(kind, tmdbId) : await this.seerr.trailer(kind, tmdbId);
      if (this.cache.size >= 1000) this.cache.clear();
      this.cache.set(key, { at: this.now(), trailer });
      return { trailer };
    } catch {
      // Unreachable: the page simply has no trailer button (asked again next time).
      return { trailer: null };
    }
  }
}
