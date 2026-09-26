import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, libraries, mediaFiles, movies, shows } from '../db/schema.js';
import { codecLabel, COPYABLE_VIDEO, libraryVerdict, REFERENCE_CAPS, videoSupport } from '../playback/compatibility.js';

/**
 * Library Health: what is in the library and what needs attention, computed from what the scanner
 * and FFprobe already stored. Nothing here opens a media file or starts a scan.
 */

export type HealthKey =
  | 'direct'
  | 'remux'
  | 'browser-dependent'
  | 'unsupported'
  | 'hevc'
  | 'av1'
  | '10-bit'
  | 'hdr'
  | 'dolby-vision'
  | 'unsupported-audio'
  | 'pgs'
  | 'vobsub'
  | 'missing-metadata'
  | 'missing-artwork'
  | 'scan-errors'
  | 'not-analyzed'
  | 'duplicates';

export interface HealthCategory {
  key: HealthKey;
  label: string;
  group: 'playback' | 'formats' | 'library';
  /** Files, or movies/shows for the metadata categories, or items with more than one version. */
  unit: 'files' | 'items';
  description: string;
}

export const HEALTH_CATEGORIES: HealthCategory[] = [
  { key: 'direct', label: 'Direct Play', group: 'playback', unit: 'files', description: 'Plays as-is in a current browser. No work for the server.' },
  { key: 'remux', label: 'Remux required', group: 'playback', unit: 'files', description: 'The video plays as-is; the audio or the container is converted on the fly, which costs little CPU.' },
  { key: 'browser-dependent', label: 'Depends on device', group: 'playback', unit: 'files', description: 'HEVC video: plays in Safari and in Chrome or Edge on hardware with HEVC decoding, not everywhere.' },
  { key: 'unsupported', label: 'Unsupported', group: 'playback', unit: 'files', description: 'Browsers cannot decode the video, and Velyx does not transcode video.' },
  { key: 'hevc', label: 'HEVC', group: 'formats', unit: 'files', description: 'HEVC / H.265 video.' },
  { key: 'av1', label: 'AV1', group: 'formats', unit: 'files', description: 'AV1 video: current Chrome, Edge and Firefox decode it; older devices and Safari may not.' },
  { key: '10-bit', label: '10-bit video', group: 'formats', unit: 'files', description: 'More than 8 bits per colour. 10-bit H.264 does not play in browsers.' },
  { key: 'hdr', label: 'HDR', group: 'formats', unit: 'files', description: 'HDR10 or HLG video. On a screen without HDR, colours can look washed out.' },
  { key: 'dolby-vision', label: 'Dolby Vision', group: 'formats', unit: 'files', description: 'Browsers show the HDR10 base layer when the file has one.' },
  { key: 'unsupported-audio', label: 'Converted audio', group: 'formats', unit: 'files', description: 'Audio browsers do not play (DTS, TrueHD, AC3, …). It is converted to AAC during playback.' },
  { key: 'pgs', label: 'PGS subtitles', group: 'formats', unit: 'files', description: 'Image-based Blu-ray subtitles. They are not shown in the browser.' },
  { key: 'vobsub', label: 'VobSub subtitles', group: 'formats', unit: 'files', description: 'Image-based DVD subtitles. They are not shown in the browser.' },
  { key: 'missing-metadata', label: 'Missing metadata', group: 'library', unit: 'items', description: 'Movies and shows that are not matched with TMDB, or have no description.' },
  { key: 'missing-artwork', label: 'Missing artwork', group: 'library', unit: 'items', description: 'Movies and shows without a poster.' },
  { key: 'scan-errors', label: 'Scan errors', group: 'library', unit: 'files', description: 'FFprobe could not read these files. They may be damaged or still being copied.' },
  { key: 'not-analyzed', label: 'Not fully analysed', group: 'library', unit: 'files', description: 'Scanned before Velyx recorded bit depth and HDR. They are analysed when first played.' },
  { key: 'duplicates', label: 'Possible duplicates', group: 'library', unit: 'items', description: 'Movies or episodes with more than one file, or two movies matched to the same TMDB entry.' },
];

const KEYS = new Set(HEALTH_CATEGORIES.map((c) => c.key));
export function isHealthKey(key: string): key is HealthKey {
  return KEYS.has(key as HealthKey);
}

const FILE_COLUMNS = {
  id: mediaFiles.id,
  libraryId: mediaFiles.libraryId,
  path: mediaFiles.path,
  size: mediaFiles.size,
  container: mediaFiles.container,
  videoCodec: mediaFiles.videoCodec,
  videoBitDepth: mediaFiles.videoBitDepth,
  videoRange: mediaFiles.videoRange,
  width: mediaFiles.width,
  height: mediaFiles.height,
  audioCodec: mediaFiles.audioCodec,
  audioChannels: mediaFiles.audioChannels,
  subtitleTracks: mediaFiles.subtitleTracks,
  probeError: mediaFiles.probeError,
  movieId: mediaFiles.movieId,
  episodeId: mediaFiles.episodeId,
};
type FileRow = Pick<typeof mediaFiles.$inferSelect, keyof typeof FILE_COLUMNS>;

const IMAGE_SUBS: Record<'pgs' | 'vobsub', string> = { pgs: 'hdmv_pgs_subtitle', vobsub: 'dvd_subtitle' };

function playbackVerdict(f: FileRow): 'direct' | 'remux' | 'browser-dependent' | 'unsupported' | null {
  if (f.probeError) return null;
  const v = libraryVerdict(f);
  if (v === 'incompatible' || v === 'unknown') return 'unsupported';
  return v;
}

/** Which file categories a file belongs to. */
export function fileCategories(f: FileRow): HealthKey[] {
  const keys: HealthKey[] = [];
  const verdict = playbackVerdict(f);
  if (verdict) keys.push(verdict);
  if (f.probeError) keys.push('scan-errors');
  else if (f.videoCodec && f.videoBitDepth === null) keys.push('not-analyzed');
  if (f.videoCodec === 'hevc') keys.push('hevc');
  if (f.videoCodec === 'av1') keys.push('av1');
  if ((f.videoBitDepth ?? 8) > 8) keys.push('10-bit');
  if (f.videoRange === 'HDR10' || f.videoRange === 'HLG') keys.push('hdr');
  if (f.videoRange === 'DV') keys.push('dolby-vision');
  if (f.audioCodec && !REFERENCE_CAPS.audioCodecs.includes(f.audioCodec)) keys.push('unsupported-audio');
  const subs = f.subtitleTracks ?? [];
  if (subs.some((s) => s.codec === IMAGE_SUBS.pgs)) keys.push('pgs');
  if (subs.some((s) => s.codec === IMAGE_SUBS.vobsub)) keys.push('vobsub');
  return keys;
}

function resolution(f: Pick<FileRow, 'width' | 'height'>): string | null {
  if (!f.width || !f.height) return null;
  if (f.width >= 3200 || f.height >= 2000) return '2160p';
  if (f.width >= 1800 || f.height >= 1000) return '1080p';
  if (f.width >= 1200 || f.height >= 700) return '720p';
  return `${f.height}p`;
}

function channels(n: number | null): string | null {
  if (!n) return null;
  if (n === 1) return 'mono';
  if (n === 2) return 'stereo';
  return n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} ch`;
}

/** "HEVC · 2160p · 10-bit · HDR10 · E-AC3 5.1 · MKV" */
export function formatSummary(f: FileRow): string {
  return [
    f.videoCodec ? codecLabel(f.videoCodec).replace(' / H.265', '') : null,
    resolution(f),
    (f.videoBitDepth ?? 8) > 8 ? `${f.videoBitDepth}-bit` : null,
    f.videoRange && f.videoRange !== 'SDR' ? (f.videoRange === 'DV' ? 'Dolby Vision' : f.videoRange) : null,
    f.audioCodec ? [codecLabel(f.audioCodec), channels(f.audioChannels)].filter(Boolean).join(' ') : null,
    f.container?.toUpperCase() ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Plain-language explanation of why a file is in a playback category. */
export function playbackReasons(f: FileRow): string[] {
  const verdict = playbackVerdict(f);
  if (verdict === 'direct') return ['Plays as-is: nothing is converted.'];
  if (verdict === 'browser-dependent') return ['HEVC video plays only where the device can decode it (Safari; Chrome or Edge with hardware support).'];
  if (verdict === 'unsupported') {
    if (!f.videoCodec) return ['No video stream was found in this file.'];
    const support = videoSupport(f, {});
    if (support.ok === false && support.problem) return [support.problem, 'Velyx does not transcode video.'];
    if (!COPYABLE_VIDEO.has(f.videoCodec) && !REFERENCE_CAPS.videoCodecs.includes(f.videoCodec)) return [`${codecLabel(f.videoCodec)} video cannot be decoded by web browsers.`, 'Velyx does not transcode video.'];
    return [support.problem ?? 'Browsers cannot decode this video.', 'Velyx does not transcode video.'];
  }
  if (verdict === 'remux') {
    const reasons: string[] = [];
    if (f.audioCodec && !REFERENCE_CAPS.audioCodecs.includes(f.audioCodec)) reasons.push(`${codecLabel(f.audioCodec)} audio is converted to AAC.`);
    if (f.container && !REFERENCE_CAPS.containers.includes(f.container)) reasons.push(`The ${f.container.toUpperCase()} container is repackaged as MP4.`);
    reasons.push('The video is copied without re-encoding.');
    return reasons;
  }
  return [];
}

function reasonsFor(key: HealthKey, f: FileRow): string[] {
  switch (key) {
    case 'direct':
    case 'remux':
    case 'browser-dependent':
    case 'unsupported':
      return playbackReasons(f);
    case 'scan-errors':
      return [f.probeError ?? 'FFprobe could not read this file.'];
    case 'not-analyzed':
      return ['Bit depth and HDR are not known yet.'];
    case '10-bit':
      return f.videoCodec === 'h264' ? ['10-bit H.264 (Hi10P) does not play in web browsers.'] : [];
    case 'unsupported-audio':
      return [`${codecLabel(f.audioCodec)} audio is converted to AAC during playback.`];
    case 'pgs':
    case 'vobsub': {
      const n = (f.subtitleTracks ?? []).filter((s) => s.codec === IMAGE_SUBS[key]).length;
      return [`${n} ${key === 'pgs' ? 'PGS' : 'VobSub'} track${n === 1 ? '' : 's'}; text subtitles still work.`];
    }
    default:
      return [];
  }
}

export interface HealthItem {
  kind: 'movie' | 'episode' | 'show';
  id: number;
  title: string;
  subtitle: string | null;
  /** Page in the app to open the item. */
  href: string;
  library: string;
  file: { id: number; path: string; size: number; summary: string } | null;
  reasons: string[];
}

export interface HealthSummary {
  categories: Array<HealthCategory & { count: number }>;
  files: number;
  tmdbConfigured: boolean;
}

type TitleInfo = { kind: 'movie' | 'episode'; id: number; title: string; subtitle: string | null; href: string };

export class LibraryHealth {
  constructor(
    private readonly db: DB,
    private readonly tmdbConfigured: () => boolean,
  ) {}

  private files(libraryId?: number): FileRow[] {
    return this.db
      .select(FILE_COLUMNS)
      .from(mediaFiles)
      .where(libraryId ? eq(mediaFiles.libraryId, libraryId) : undefined)
      .all();
  }

  private metadataWhere(table: typeof movies | typeof shows, key: 'missing-metadata' | 'missing-artwork', libraryId?: number): SQL | undefined {
    const cond =
      key === 'missing-artwork'
        ? sql`${table.posterPath} IS NULL`
        : sql`(${table.matchStatus} IN ('pending', 'unmatched') OR ${table.overview} IS NULL OR ${table.overview} = '')`;
    return libraryId ? and(cond, eq(table.libraryId, libraryId)) : cond;
  }

  /** Movie ids / episode ids with several files, and movies sharing a TMDB id in one library. */
  private duplicates(libraryId?: number) {
    const lib = libraryId ? sql`AND ${mediaFiles.libraryId} = ${libraryId}` : sql``;
    const movieIds = this.db
      .all<{ id: number }>(sql`SELECT ${mediaFiles.movieId} AS id FROM ${mediaFiles} WHERE ${mediaFiles.movieId} IS NOT NULL ${lib} GROUP BY ${mediaFiles.movieId} HAVING count(*) > 1`)
      .map((r) => r.id);
    const episodeIds = this.db
      .all<{ id: number }>(sql`SELECT ${mediaFiles.episodeId} AS id FROM ${mediaFiles} WHERE ${mediaFiles.episodeId} IS NOT NULL ${lib} GROUP BY ${mediaFiles.episodeId} HAVING count(*) > 1`)
      .map((r) => r.id);
    const movieLib = libraryId ? sql`AND ${movies.libraryId} = ${libraryId}` : sql``;
    const sameTmdb = this.db
      .all<{ ids: string }>(sql`SELECT group_concat(${movies.id}) AS ids FROM ${movies} WHERE ${movies.tmdbId} IS NOT NULL ${movieLib} GROUP BY ${movies.libraryId}, ${movies.tmdbId} HAVING count(*) > 1`)
      .map((r) => r.ids.split(',').map(Number));
    return { movieIds, episodeIds, sameTmdb };
  }

  summary(libraryId?: number): HealthSummary {
    const counts = new Map<HealthKey, number>();
    const files = this.files(libraryId);
    for (const f of files) for (const k of fileCategories(f)) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const key of ['missing-metadata', 'missing-artwork'] as const) {
      const n =
        this.db.select({ n: sql<number>`count(*)` }).from(movies).where(this.metadataWhere(movies, key, libraryId)).get()!.n +
        this.db.select({ n: sql<number>`count(*)` }).from(shows).where(this.metadataWhere(shows, key, libraryId)).get()!.n;
      counts.set(key, Number(n));
    }
    const d = this.duplicates(libraryId);
    const tmdbDupes = new Set(d.sameTmdb.flat().filter((id) => !d.movieIds.includes(id)));
    counts.set('duplicates', d.movieIds.length + d.episodeIds.length + tmdbDupes.size);
    return {
      categories: HEALTH_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.key) ?? 0 })),
      files: files.length,
      tmdbConfigured: this.tmdbConfigured(),
    };
  }

  /** The items in one category, one page at a time, sorted by title. */
  items(key: HealthKey, opts: { libraryId?: number; page: number; limit: number }): { total: number; items: HealthItem[] } {
    const libs = new Map(this.db.select({ id: libraries.id, name: libraries.name, path: libraries.path }).from(libraries).all().map((l) => [l.id, l]));
    let all: HealthItem[];
    if (key === 'missing-metadata' || key === 'missing-artwork') all = this.metadataItems(key, opts.libraryId, libs);
    else if (key === 'duplicates') all = this.duplicateItems(opts.libraryId, libs);
    else {
      const matching = this.files(opts.libraryId).filter((f) => fileCategories(f).includes(key));
      const titles = this.titles(matching);
      all = matching.map((f) => {
        const t = titles.get(f.id);
        const lib = libs.get(f.libraryId);
        return {
          kind: t?.kind ?? 'movie',
          id: t?.id ?? 0,
          title: t?.title ?? 'Not linked to a movie or episode',
          subtitle: t?.subtitle ?? null,
          href: t?.href ?? '/admin/libraries',
          library: lib?.name ?? '',
          file: { id: f.id, path: relativePath(lib?.path, f.path), size: f.size, summary: formatSummary(f) },
          reasons: reasonsFor(key, f),
        };
      });
    }
    all.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || (a.subtitle ?? '').localeCompare(b.subtitle ?? '', undefined, { numeric: true }));
    const start = (opts.page - 1) * opts.limit;
    return { total: all.length, items: all.slice(start, start + opts.limit) };
  }

  private titles(files: FileRow[]): Map<number, TitleInfo> {
    const map = new Map<number, TitleInfo>();
    const movieIds = [...new Set(files.map((f) => f.movieId).filter((id): id is number => id !== null))];
    const episodeIds = [...new Set(files.map((f) => f.episodeId).filter((id): id is number => id !== null))];
    const movieRows = new Map<number, { title: string; year: number | null }>();
    const episodeRows = new Map<number, { showId: number; show: string; s: number; e: number; title: string | null }>();
    for (let i = 0; i < movieIds.length; i += 500) {
      for (const m of this.db.select({ id: movies.id, title: movies.title, year: movies.year }).from(movies).where(inArray(movies.id, movieIds.slice(i, i + 500))).all()) movieRows.set(m.id, m);
    }
    for (let i = 0; i < episodeIds.length; i += 500) {
      const rows = this.db
        .select({ id: episodes.id, showId: shows.id, show: shows.title, s: episodes.seasonNumber, e: episodes.episodeNumber, title: episodes.title })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(inArray(episodes.id, episodeIds.slice(i, i + 500)))
        .all();
      for (const r of rows) episodeRows.set(r.id, r);
    }
    for (const f of files) {
      if (f.movieId && movieRows.has(f.movieId)) {
        const m = movieRows.get(f.movieId)!;
        map.set(f.id, { kind: 'movie', id: f.movieId, title: m.title, subtitle: m.year ? String(m.year) : null, href: `/movies/${f.movieId}` });
      } else if (f.episodeId && episodeRows.has(f.episodeId)) {
        const e = episodeRows.get(f.episodeId)!;
        map.set(f.id, { kind: 'episode', id: f.episodeId, title: e.show, subtitle: `S${pad(e.s)}E${pad(e.e)}${e.title ? ` · ${e.title}` : ''}`, href: `/shows/${e.showId}` });
      }
    }
    return map;
  }

  private metadataItems(key: 'missing-metadata' | 'missing-artwork', libraryId: number | undefined, libs: Map<number, { name: string }>): HealthItem[] {
    const reason = (r: { matchStatus: string; overview: string | null }) => {
      if (key === 'missing-artwork') return ['No poster.'];
      if (r.matchStatus === 'pending') return [this.tmdbConfigured() ? 'Waiting for metadata: it is looked up at the next scan.' : 'TMDB is not configured, so no metadata is looked up.'];
      if (r.matchStatus === 'unmatched') return ['Not matched with TMDB. Use Fix match to pick the right title.'];
      return ['No description.'];
    };
    const cols = { id: movies.id, title: movies.title, year: movies.year, libraryId: movies.libraryId, matchStatus: movies.matchStatus, overview: movies.overview };
    const movieRows = this.db.select(cols).from(movies).where(this.metadataWhere(movies, key, libraryId)).all();
    const showRows = this.db
      .select({ id: shows.id, title: shows.title, year: shows.year, libraryId: shows.libraryId, matchStatus: shows.matchStatus, overview: shows.overview })
      .from(shows)
      .where(this.metadataWhere(shows, key, libraryId))
      .all();
    return [
      ...movieRows.map((r) => ({ kind: 'movie' as const, id: r.id, title: r.title, subtitle: r.year ? String(r.year) : null, href: `/movies/${r.id}`, library: libs.get(r.libraryId)?.name ?? '', file: null, reasons: reason(r) })),
      ...showRows.map((r) => ({ kind: 'show' as const, id: r.id, title: r.title, subtitle: r.year ? String(r.year) : null, href: `/shows/${r.id}`, library: libs.get(r.libraryId)?.name ?? '', file: null, reasons: reason(r) })),
    ];
  }

  private duplicateItems(libraryId: number | undefined, libs: Map<number, { name: string; path: string }>): HealthItem[] {
    const d = this.duplicates(libraryId);
    const items: HealthItem[] = [];
    const versions = (column: typeof mediaFiles.movieId | typeof mediaFiles.episodeId, ids: number[]) => {
      const byOwner = new Map<number, FileRow[]>();
      for (let i = 0; i < ids.length; i += 500) {
        const rows = this.db
          .select(FILE_COLUMNS)
          .from(mediaFiles)
          .where(and(inArray(column, ids.slice(i, i + 500)), isNotNull(column)))
          .all();
        for (const r of rows) {
          const owner = (column === mediaFiles.movieId ? r.movieId : r.episodeId)!;
          byOwner.set(owner, [...(byOwner.get(owner) ?? []), r]);
        }
      }
      return byOwner;
    };
    const describe = (files: FileRow[]) => files.map((f) => `${formatSummary(f) || 'Unknown format'} · ${formatSize(f.size)} — ${relativePath(libs.get(f.libraryId)?.path, f.path)}`);
    for (const [owner, files] of [...versions(mediaFiles.movieId, d.movieIds), ...versions(mediaFiles.episodeId, d.episodeIds)]) {
      const t = this.titles(files).get(files[0].id);
      if (!t || t.id !== owner) continue;
      items.push({ ...t, library: libs.get(files[0].libraryId)?.name ?? '', file: null, reasons: [`${files.length} versions:`, ...describe(files)] });
    }
    const listed = new Set(d.movieIds);
    for (const group of d.sameTmdb) {
      const rows = this.db.select({ id: movies.id, title: movies.title, year: movies.year, libraryId: movies.libraryId }).from(movies).where(inArray(movies.id, group)).all();
      for (const r of rows) {
        if (listed.has(r.id)) continue;
        const others = rows.filter((o) => o.id !== r.id).map((o) => `“${o.title}${o.year ? ` (${o.year})` : ''}”`);
        items.push({
          kind: 'movie', id: r.id, title: r.title, subtitle: r.year ? String(r.year) : null, href: `/movies/${r.id}`, library: libs.get(r.libraryId)?.name ?? '', file: null,
          reasons: [`Matched to the same TMDB movie as ${others.join(', ')}. Usually two copies in different folders, or a wrong match.`],
        });
      }
    }
    return items;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** Path shown to admins: relative to the library folder, so it stays short. */
function relativePath(root: string | undefined, file: string): string {
  if (root && file.startsWith(root)) return file.slice(root.length).replace(/^[/\\]+/, '');
  return file;
}
