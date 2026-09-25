import path from 'node:path';

export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.ogv']);
export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

export function isVideoFile(file: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function isSubtitleFile(file: string): boolean {
  return SUBTITLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Files named like "sample" or trailers/extras are not library items. */
export function isExtraFile(relPath: string): boolean {
  const lower = relPath.toLowerCase().replace(/\\/g, '/');
  const base = path.basename(lower, path.extname(lower));
  if (/(^|[\s._-])sample($|[\s._-])/.test(base)) return true;
  if (/-(trailer|featurette|behindthescenes|deleted|interview|scene|short|extra)$/.test(base)) return true;
  return /\/(extras|featurettes|trailers|behind the scenes|deleted scenes|interviews|samples?)\//.test('/' + lower);
}

const QUALITY_TOKENS = [
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'hdr', 'hdr10', 'dv', 'dolby vision',
  'bluray', 'blu ray', 'bdrip', 'brrip', 'bdremux', 'remux', 'web dl', 'webdl', 'web rip', 'webrip', 'web',
  'hdtv', 'dvdrip', 'dvdscr', 'dvd', 'hdrip', 'x264', 'x265', 'h264', 'h 264', 'h265', 'h 265', 'hevc', 'avc',
  'xvid', 'divx', 'aac', 'ac3', 'eac3', 'dts', 'dts hd', 'truehd', 'atmos', 'ddp5', 'dd5', '10bit', '8bit',
  'proper', 'repack', 'extended', 'unrated', 'remastered', 'directors cut', 'imax', 'multi', 'subbed', 'dubbed',
  'nf', 'amzn', 'dsnp', 'hmax', 'atvp',
];
const QUALITY_RE = new RegExp(`(?:^|\\s)(?:${QUALITY_TOKENS.map((t) => t.replace(/ /g, '\\s')).join('|')})(?=\\s|$)`, 'i');

const TMDB_TAG_RE = /[[{(]\s*tmdb(?:id)?\s*[-=:]\s*(\d+)\s*[\]})]/i;
const PART_RE = /\s(?:cd|disc|disk|part|pt)\s?\d{1,2}$/i;

function stripTags(input: string): { text: string; tmdbId: number | null } {
  const m = TMDB_TAG_RE.exec(input);
  let text = input;
  let tmdbId: number | null = null;
  if (m) {
    tmdbId = Number(m[1]);
    text = text.replace(m[0], ' ');
  }
  // Remove other id tags like {imdb-tt123} [tvdbid-1]
  text = text.replace(/[[{]\s*(?:imdb|tvdb)(?:id)?\s*[-=:][^\]}]*[\]}]/gi, ' ');
  return { text, tmdbId };
}

/** Converts separators to spaces and collapses whitespace. Keeps hyphens inside words (Spider-Man). */
export function cleanName(input: string): string {
  return input
    .replace(/[._]+/g, ' ')
    .replace(/\s-\s|\s-$|^-\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyTitle(input: string): string {
  return input
    .replace(/[[({]\s*$/, '')
    .replace(/[\s\-–:,([{]+$/g, '')
    .replace(/^[\s\-–:,)\]}]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedName {
  title: string;
  year: number | null;
  tmdbId: number | null;
}

/** Parses a release-style name such as "Interstellar.2014.1080p.BluRay.x264". */
export function parseReleaseName(raw: string): ParsedName {
  const { text: untagged, tmdbId } = stripTags(raw);
  let name = cleanName(untagged.replace(/\[((?:18|19|20)\d{2})\]/g, ' ($1) ')).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

  const currentYear = new Date().getFullYear() + 1;
  const yearRe = /(?:^|[\s([])((?:18|19|20)\d{2})(?=[\s)\]]|$)/g;
  const candidates: { year: number; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(name)) !== null) {
    const year = Number(m[1]);
    if (year >= 1880 && year <= currentYear) candidates.push({ year, index: m.index + m[0].indexOf(m[1]) });
  }
  // A year at the very start is part of the title (e.g. "1917", "2001 A Space Odyssey 1968").
  const usable = candidates.filter((c) => c.index > 0);
  let year: number | null = null;
  let title: string;
  if (usable.length > 0) {
    const pick = usable[usable.length - 1];
    year = pick.year;
    title = name.slice(0, pick.index);
  } else {
    const q = QUALITY_RE.exec(name);
    title = q ? name.slice(0, q.index) : name;
  }
  // Anything left that still looks like release junk is cut off at the first quality token.
  const q2 = QUALITY_RE.exec(title);
  if (q2 && q2.index > 0) title = title.slice(0, q2.index);
  title = tidyTitle(title.replace(/\(\s*\)/g, ' ').replace(PART_RE, ''));
  if (!title) {
    title = tidyTitle(name) || raw;
  }
  name = title;
  return { title: name, year, tmdbId };
}

const GENERIC_NAMES = /^(movie|video|film|feature|main|title\s?\d*|vts[\s_]\d+.*|\d{1,3}|cd\s?\d|disc\s?\d|part\s?\d)$/i;

/**
 * Parses a movie file path (relative to the library root). The parent folder is used when it carries
 * better information — e.g. "Interstellar (2014)/movie.mkv".
 */
export function parseMoviePath(relPath: string): ParsedName {
  const normalized = relPath.replace(/\\/g, '/');
  const base = path.posix.basename(normalized, path.posix.extname(normalized));
  const segments = normalized.split('/');
  const folder = segments.length > 1 ? segments[segments.length - 2] : null;

  const fromFile = parseReleaseName(base);
  if (!folder) return fromFile;
  const fromFolder = parseReleaseName(folder);

  const tmdbId = fromFile.tmdbId ?? fromFolder.tmdbId;
  if (GENERIC_NAMES.test(fromFile.title) || fromFile.title.length < 2) {
    return { ...fromFolder, tmdbId };
  }
  if (fromFile.year === null && fromFolder.year !== null && similarity(fromFile.title, fromFolder.title) > 0.6) {
    return { title: fromFolder.title, year: fromFolder.year, tmdbId };
  }
  return { ...fromFile, tmdbId };
}

export interface ParsedEpisode {
  showTitle: string;
  showYear: number | null;
  showTmdbId: number | null;
  season: number;
  episode: number;
  episodeEnd: number | null;
  episodeTitle: string | null;
}

const SE_PATTERNS: RegExp[] = [
  /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?:[\s._-]*(?:-|e)(\d{1,3}))?(?![0-9])/i,
  /(?<![0-9a-z])(\d{1,2})x(\d{2,3})(?:[-x](\d{2,3}))?(?![0-9])/i,
  /season[\s._-]*(\d{1,2})[\s._-]*(?:episode|ep|e)[\s._-]*(\d{1,3})(?![0-9])/i,
];

function seasonFromFolder(folder: string): number | null {
  const f = folder.trim();
  if (/^specials?$/i.test(f)) return 0;
  const m = /^(?:season|series|staffel|seizoen|saison|temporada|s)[\s._-]*(\d{1,3})$/i.exec(f);
  return m ? Number(m[1]) : null;
}

/**
 * Parses an episode path relative to a TV library root, e.g.
 * "Breaking Bad/Season 01/Breaking.Bad.S01E02.720p.mkv" or "The Office/1x02 - Diversity Day.mkv".
 */
export function parseEpisodePath(relPath: string): ParsedEpisode | null {
  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const file = segments[segments.length - 1];
  const base = path.posix.basename(file, path.posix.extname(file));
  const showFolder = segments.length > 1 ? segments[0] : null;
  const parentFolder = segments.length > 2 ? segments[segments.length - 2] : null;

  let season: number | null = null;
  let episode: number | null = null;
  let episodeEnd: number | null = null;
  let before = '';
  let after = '';

  for (const re of SE_PATTERNS) {
    const m = re.exec(base);
    if (m) {
      season = Number(m[1]);
      episode = Number(m[2]);
      episodeEnd = m[3] ? Number(m[3]) : null;
      before = base.slice(0, m.index);
      after = base.slice(m.index + m[0].length);
      break;
    }
  }

  if (season === null) {
    const folderSeason = parentFolder ? seasonFromFolder(parentFolder) : null;
    const m = /^(?:e|ep|episode)?[\s._-]*(\d{1,3})(?![0-9])(.*)$/i.exec(cleanName(base));
    if (folderSeason !== null && m) {
      season = folderSeason;
      episode = Number(m[1]);
      after = m[2];
    }
  }
  if (season === null || episode === null) return null;

  let showTitle = '';
  let showYear: number | null = null;
  let showTmdbId: number | null = null;
  if (showFolder && seasonFromFolder(showFolder) === null) {
    const p = parseReleaseName(showFolder);
    showTitle = p.title;
    showYear = p.year;
    showTmdbId = p.tmdbId;
  }
  if (!showTitle) {
    const p = parseReleaseName(before);
    showTitle = p.title;
    showYear = p.year;
  }
  if (!showTitle) return null;

  let episodeTitle: string | null = cleanName(after);
  const q = QUALITY_RE.exec(episodeTitle);
  if (q) episodeTitle = episodeTitle.slice(0, q.index);
  episodeTitle = tidyTitle(episodeTitle.replace(/\[[^\]]*\]/g, '')) || null;

  return { showTitle, showYear, showTmdbId, season, episode, episodeEnd, episodeTitle };
}

/** Normalizes a title for comparison and grouping. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

/** Title used for alphabetical ordering ("The Matrix" sorts under M). */
export function sortTitle(title: string): string {
  return title.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

/** Similarity in [0,1] combining Levenshtein ratio and Dice bigram coefficient. */
export function similarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const ba = bigrams(x);
  const bb = bigrams(y);
  let overlap = 0;
  for (const [g, n] of ba) overlap += Math.min(n, bb.get(g) ?? 0);
  const total = [...ba.values()].reduce((s, n) => s + n, 0) + [...bb.values()].reduce((s, n) => s + n, 0);
  const dice = total > 0 ? (2 * overlap) / total : 0;
  return Math.max(lev, dice);
}

/** Detects language/forced flags from an external subtitle name like "Movie.nl.forced.srt". */
export function parseSubtitleName(videoBase: string, subtitleFile: string): { language: string | null; forced: boolean; label: string } | null {
  const ext = path.extname(subtitleFile);
  const subBase = path.basename(subtitleFile, ext);
  if (subBase !== videoBase && !subBase.startsWith(videoBase + '.') && !subBase.startsWith(videoBase + '_')) return null;
  const suffix = subBase.slice(videoBase.length).replace(/^[._]/, '');
  const parts = suffix.split(/[._]/).filter(Boolean).map((p) => p.toLowerCase());
  const forced = parts.includes('forced');
  const sdh = parts.includes('sdh') || parts.includes('cc') || parts.includes('hi');
  const language = parts.find((p) => /^[a-z]{2,3}(-[a-z]{2})?$/.test(p) && !['sdh', 'forced', 'cc', 'hi'].includes(p)) ?? null;
  const labelParts = [language ? languageName(language) : 'Unknown'];
  if (forced) labelParts.push('(forced)');
  if (sdh) labelParts.push('(SDH)');
  return { language, forced, label: labelParts.join(' ') };
}

const LANG_NAMES: Record<string, string> = {
  en: 'English', eng: 'English', nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', de: 'German', ger: 'German', deu: 'German',
  fr: 'French', fre: 'French', fra: 'French', es: 'Spanish', spa: 'Spanish', it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese', sv: 'Swedish', swe: 'Swedish', da: 'Danish', dan: 'Danish', no: 'Norwegian',
  nor: 'Norwegian', nb: 'Norwegian', fi: 'Finnish', fin: 'Finnish', pl: 'Polish', pol: 'Polish', ru: 'Russian',
  rus: 'Russian', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese',
  zho: 'Chinese', ar: 'Arabic', ara: 'Arabic', tr: 'Turkish', tur: 'Turkish', hi: 'Hindi', hin: 'Hindi',
};

export function languageName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  const c = code.toLowerCase().split('-')[0];
  return LANG_NAMES[c] ?? code.toUpperCase();
}
