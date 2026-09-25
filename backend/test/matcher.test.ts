import { describe, expect, it } from 'vitest';
import { AUTO_MATCH_THRESHOLD, pickBest, rankCandidates } from '../src/services/matcher.js';
import type { TmdbSearchResult } from '../src/services/tmdb.js';

const c = (id: number, title: string, year: number | null, popularity = 1): TmdbSearchResult => ({ id, title, originalTitle: null, year, overview: null, posterPath: null, popularity });

describe('metadata matching', () => {
  it('prefers exact title + year over the first search result', () => {
    const ranked = rankCandidates({ title: 'Dune', year: 2021 }, [c(1, 'Dune', 1984, 50), c(2, 'Dune', 2021, 40), c(3, 'Dune: Part Two', 2024, 90)]);
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].confidence).toBeGreaterThan(0.95);
  });

  it('accepts a close year (±1) with lower confidence', () => {
    const ranked = rankCandidates({ title: 'Interstellar', year: 2015 }, [c(157336, 'Interstellar', 2014)]);
    expect(pickBest(ranked)?.id).toBe(157336);
  });

  it('rejects weak matches so an admin can review them', () => {
    const ranked = rankCandidates({ title: 'My Holiday Video', year: 2012 }, [c(9, 'Holiday', 2006)]);
    expect(ranked[0].confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(pickBest(ranked)).toBeNull();
  });

  it('handles missing year neutrally', () => {
    const best = pickBest(rankCandidates({ title: 'Up', year: null }, [c(14160, 'Up', 2009)]));
    expect(best?.id).toBe(14160);
  });
});
