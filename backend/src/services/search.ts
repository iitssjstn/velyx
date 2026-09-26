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
