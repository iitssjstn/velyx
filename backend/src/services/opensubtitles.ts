import fsp from 'node:fs/promises';
import { HttpError } from '../http-error.js';

/**
 * Languages offered for searching, as OpenSubtitles names them (lower case). Portuguese and Chinese
 * come in two variants there.
 */
export const ONLINE_SUBTITLE_LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'ko', 'lt', 'lv', 'ms',
  'nl', 'no', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-cn', 'zh-tw',
] as const;
export type OnlineSubtitleLanguage = (typeof ONLINE_SUBTITLE_LANGUAGES)[number];

export function isOnlineSubtitleLanguage(v: string): v is OnlineSubtitleLanguage {
  return (ONLINE_SUBTITLE_LANGUAGES as readonly string[]).includes(v);
}

export type OpenSubtitlesErrorKind = 'not-configured' | 'quota' | 'unreachable' | 'failed';

export class OpenSubtitlesError extends Error {
  constructor(
    message: string,
    readonly kind: OpenSubtitlesErrorKind,
    readonly status: number | null = null,
    /** When the download allowance resets (quota errors), as the provider reports it. */
    readonly resetAt: string | null = null,
  ) {
    super(message);
    this.name = 'OpenSubtitlesError';
  }
}

/** What to search for: the file's hash plus the movie or episode it is. */
export interface SubtitleQuery {
  language: OnlineSubtitleLanguage;
  hash?: string | null;
  type: 'movie' | 'episode';
  tmdbId?: number | null;
  imdbId?: string | null;
  /** Episodes: the show's ids with season and episode number. */
  parentTmdbId?: number | null;
  parentImdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  /** Title search, when the item has no ids. */
  query?: string | null;
  year?: number | null;
}

export interface OnlineSubtitle {
  /** The provider's file id (what is downloaded). */
  fileId: number;
  language: string;
  release: string;
  hearingImpaired: boolean;
  /** Only the parts in another language ("forced"). */
  forced: boolean;
  downloads: number;
  /** Made for exactly this file (the file hash matched). */
  hashMatch: boolean;
  /** Translated by a machine instead of a person. */
  machineTranslated: boolean;
  trusted: boolean;
}

interface ApiSubtitle {
  attributes?: {
    language?: string;
    release?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    foreign_parts_only?: boolean;
    moviehash_match?: boolean;
    ai_translated?: boolean;
    machine_translated?: boolean;
    from_trusted?: boolean;
    files?: { file_id?: number; file_name?: string }[];
  };
}

/**
 * The OpenSubtitles hash of a video file: its size plus the sum of the first and last 64 KiB read
 * as little-endian 64-bit numbers (modulo 2^64), as 16 hex digits. Null for files under 128 KiB.
 */
export async function movieHash(file: string): Promise<string | null> {
  const CHUNK = 64 * 1024;
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < CHUNK * 2) return null;
    const buf = Buffer.alloc(CHUNK * 2);
    await handle.read(buf, 0, CHUNK, 0);
    await handle.read(buf, CHUNK, CHUNK, size - CHUNK);
    let sum = BigInt(size);
    for (let i = 0; i < buf.length; i += 8) sum = (sum + buf.readBigUInt64LE(i)) & 0xffffffffffffffffn;
    return sum.toString(16).padStart(16, '0');
  } finally {
    await handle.close();
  }
}

/** Best first: made for this file, by a person, from a trusted uploader, most downloaded. */
export function rankSubtitles(list: OnlineSubtitle[]): OnlineSubtitle[] {
  return [...list].sort(
    (a, b) =>
      Number(b.hashMatch) - Number(a.hashMatch) ||
      Number(a.machineTranslated) - Number(b.machineTranslated) ||
      Number(a.forced) - Number(b.forced) ||
      Number(b.trusted) - Number(a.trusted) ||
      b.downloads - a.downloads,
  );
}

/** Online subtitles through vidalune.com (its own OpenSubtitles key), for a linked server. */
export interface VidaluneSubtitles {
  linked(): boolean;
  subtitleSearch(query: SubtitleQuery): Promise<unknown[]>;
  subtitleDownload(fileId: number): Promise<Buffer>;
}

/** The subtitles in an answer of the search API that one video file can use. */
export function parseSubtitles(data: unknown[], language: string): OnlineSubtitle[] {
  const out: OnlineSubtitle[] = [];
  for (const item of data as ApiSubtitle[]) {
    const a = item?.attributes;
    // Subtitles split over several files (old CD releases) cannot be used for one video file.
    if (!a || a.files?.length !== 1 || typeof a.files[0]!.file_id !== 'number') continue;
    out.push({
      fileId: a.files[0]!.file_id!,
      language: (a.language ?? language).toLowerCase(),
      release: (a.release || a.files[0]!.file_name || '').slice(0, 300),
      hearingImpaired: Boolean(a.hearing_impaired),
      forced: Boolean(a.foreign_parts_only),
      downloads: a.download_count ?? 0,
      hashMatch: Boolean(a.moviehash_match),
      machineTranslated: Boolean(a.ai_translated || a.machine_translated),
      trusted: Boolean(a.from_trusted),
    });
  }
  return rankSubtitles(out);
}

/** What went wrong at vidalune.com, as the error the subtitle routes explain. */
function vidaluneError(err: unknown): OpenSubtitlesError {
  const status = err instanceof HttpError ? err.statusCode : 502;
  if (status === 429) return new OpenSubtitlesError((err as Error).message, 'quota', 429);
  if (status === 403 || status === 409 || status === 503) return new OpenSubtitlesError((err as Error).message, 'not-configured', status);
  return new OpenSubtitlesError((err as Error).message, 'unreachable', status);
}

export interface OpenSubtitlesOptions {
  /** Subtitles through vidalune.com (its OpenSubtitles key), for a server linked to a Vidalune account. */
  vidalune: VidaluneSubtitles;
}

/**
 * Online subtitles: searched and downloaded through vidalune.com, which asks OpenSubtitles with its
 * own key and keeps the files it fetched. Only for a server linked to a Vidalune account.
 */
export class OpenSubtitlesClient {
  constructor(private readonly opts: OpenSubtitlesOptions) {}

  get configured(): boolean {
    return this.via !== null;
  }

  /** How subtitles are found: through vidalune.com, or not at all (not linked). */
  get via(): 'vidalune' | null {
    return this.opts.vidalune.linked() ? 'vidalune' : null;
  }

  async search(q: SubtitleQuery): Promise<OnlineSubtitle[]> {
    if (!this.via) throw new OpenSubtitlesError('Not linked to a Vidalune account.', 'not-configured');
    const data = await this.opts.vidalune.subtitleSearch(q).catch((err: unknown) => {
      throw vidaluneError(err);
    });
    return parseSubtitles(Array.isArray(data) ? data : [], q.language);
  }

  /** Downloads one subtitle file as SubRip text (bytes; the caller decodes them). */
  async download(fileId: number): Promise<{ data: Buffer }> {
    if (!this.via) throw new OpenSubtitlesError('Not linked to a Vidalune account.', 'not-configured');
    const data = await this.opts.vidalune.subtitleDownload(fileId).catch((err: unknown) => {
      throw vidaluneError(err);
    });
    return { data };
  }
}
