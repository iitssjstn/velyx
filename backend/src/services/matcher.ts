import { similarity } from './parser.js';
import type { TmdbSearchResult } from './tmdb.js';

export interface ScoredCandidate extends TmdbSearchResult {
  confidence: number;
}

/** Minimum confidence required to accept a match automatically. Lower scores go to "Needs review". */
export const AUTO_MATCH_THRESHOLD = 0.62;

export function scoreCandidate(query: { title: string; year: number | null }, c: TmdbSearchResult, rank: number): number {
  const titleScore = Math.max(similarity(query.title, c.title), c.originalTitle ? similarity(query.title, c.originalTitle) : 0);
  let yearScore: number;
  if (query.year && c.year) {
    const diff = Math.abs(query.year - c.year);
    yearScore = diff === 0 ? 1 : diff === 1 ? 0.7 : 0;
  } else {
    yearScore = 0.5; // unknown year: neutral
  }
  // Tiny tie-breaker for TMDB's own relevance ranking.
  const rankBonus = rank === 0 ? 0.02 : 0;
  let score = titleScore * 0.75 + yearScore * 0.25 + rankBonus;
  if (query.year && c.year && Math.abs(query.year - c.year) > 1) score -= 0.1;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

export function rankCandidates(query: { title: string; year: number | null }, candidates: TmdbSearchResult[]): ScoredCandidate[] {
  return candidates
    .map((c, i) => ({ ...c, confidence: scoreCandidate(query, c, i) }))
    .sort((a, b) => b.confidence - a.confidence || b.popularity - a.popularity);
}

export function pickBest(ranked: ScoredCandidate[]): ScoredCandidate | null {
  const best = ranked[0];
  if (!best || best.confidence < AUTO_MATCH_THRESHOLD) return null;
  return best;
}
