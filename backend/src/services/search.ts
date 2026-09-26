/**
 * Turns what someone typed into an FTS5 query: every word must match the start of a word in the
 * title ("spider man" → "spider"* AND "man"*), punctuation is ignored, and FTS syntax in the input
 * is neutralised. Returns null when nothing searchable is left.
 */
export function ftsQuery(input: string): string | null {
  const words = input
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND ');
}

/** Kind code used in search_index rowids (see migration 0008_search_fts). */
export const SEARCH_KIND = { movie: 1, show: 2, episode: 3 } as const;

export interface EpisodeCode {
  season: number;
  /** null: the whole season ("reacher s02"). */
  episode: number | null;
  /** The rest of the query (usually the show title), possibly empty. */
  rest: string;
}

const CODE_PATTERNS: RegExp[] = [
  /\bs(\d{1,3})\s*[ .-]?\s*e(\d{1,4})\b/i, // S02E04, s2e4, S02 E04
  /\b(\d{1,2})x(\d{1,4})\b/i, // 2x04
  /\bseason\s*(\d{1,3})\s*[,.]?\s*(?:episode|ep\.?)\s*(\d{1,4})\b/i, // season 2 episode 4
  /\bs(\d{1,3})\b()/i, // S02 (a whole season)
  /\bseason\s*(\d{1,3})\b()/i, // season 2
];

/**
 * Finds a season/episode identifier in what someone typed ("reacher s02e04", "2x04", "season 2
 * episode 4", "reacher s02"). Returns null when there is none.
 */
export function parseEpisodeCode(input: string): EpisodeCode | null {
  for (const re of CODE_PATTERNS) {
    const m = re.exec(input);
    if (!m) continue;
    const season = Number(m[1]);
    const episode = m[2] ? Number(m[2]) : null;
    const rest = (input.slice(0, m.index) + ' ' + input.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { season, episode, rest };
  }
  return null;
}
