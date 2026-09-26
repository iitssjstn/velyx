import fsp from 'node:fs/promises';
import { createLogger } from '../logger.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('opensubtitles');
const API_BASE = 'https://api.opensubtitles.com/api/v1';

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

export type OpenSubtitlesErrorKind = 'not-configured' | 'auth' | 'quota' | 'unreachable' | 'failed';

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

export interface OpenSubtitlesCredentials {
  apiKey: string;
  username: string;
  password: string;
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

export interface OpenSubtitlesOptions {
  getCredentials: () => OpenSubtitlesCredentials;
  fetchImpl?: FetchLike;
  userAgent: string;
}

/**
 * Minimal OpenSubtitles.com REST client: search and download. Signing in with an account is
 * optional and raises the daily download allowance; the token is kept for a day.
 */
export class OpenSubtitlesClient {
  private readonly fetchImpl: FetchLike;
  private token: { value: string; base: string; forKey: string; until: number } | null = null;

  constructor(private readonly opts: OpenSubtitlesOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get configured(): boolean {
    return Boolean(this.opts.getCredentials().apiKey);
  }

  /** Forget the sign-in (credentials changed). */
  reset(): void {
    this.token = null;
  }

  private headers(apiKey: string, token?: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      'User-Agent': this.opts.userAgent,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new OpenSubtitlesError(`OpenSubtitles could not be reached: ${(err as Error).message}`, 'unreachable');
    }
    const body = (await res.json().catch(() => ({}))) as T & { message?: string; errors?: string[]; reset_time_utc?: string };
    if (res.ok) return body;
    const message = body.message ?? body.errors?.join(', ') ?? `OpenSubtitles returned ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new OpenSubtitlesError(message, 'auth', res.status);
    if (res.status === 406 || res.status === 429) throw new OpenSubtitlesError(message, 'quota', res.status, body.reset_time_utc ?? null);
    throw new OpenSubtitlesError(message, 'failed', res.status);
  }

  /** Signs in with the account when one is set; returns the API base to use and the token. */
  private async session(creds: OpenSubtitlesCredentials): Promise<{ base: string; token?: string }> {
    if (!creds.username || !creds.password) return { base: API_BASE };
    const forKey = `${creds.apiKey}|${creds.username}|${creds.password}`;
    if (this.token && this.token.forKey === forKey && this.token.until > Date.now()) return { base: this.token.base, token: this.token.value };
    const r = await this.call<{ token?: string; base_url?: string }>(`${API_BASE}/login`, {
      method: 'POST',
      headers: this.headers(creds.apiKey),
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
    if (!r.token) throw new OpenSubtitlesError('OpenSubtitles did not accept the account.', 'auth');
    // Accounts may be served from another host (e.g. for VIP members).
    const base = r.base_url && /^[a-z0-9.-]+$/i.test(r.base_url) ? `https://${r.base_url}/api/v1` : API_BASE;
    this.token = { value: r.token, base, forKey, until: Date.now() + 23 * 60 * 60 * 1000 };
    return { base, token: r.token };
  }

  private credentials(): OpenSubtitlesCredentials {
    const creds = this.opts.getCredentials();
    if (!creds.apiKey) throw new OpenSubtitlesError('Searching subtitles online is not set up.', 'not-configured');
    return creds;
  }

  /** Checks a key (and account) before it is saved. */
  async verify(creds: OpenSubtitlesCredentials): Promise<void> {
    this.token = null;
    if (creds.username && creds.password) {
      await this.session(creds);
      return;
    }
    await this.call(`${API_BASE}/infos/formats`, { method: 'GET', headers: this.headers(creds.apiKey) });
  }

  async search(q: SubtitleQuery): Promise<OnlineSubtitle[]> {
    const creds = this.credentials();
    const params: Record<string, string> = { languages: q.language };
    if (q.hash) params.moviehash = q.hash;
    if (q.type === 'episode') {
      params.type = 'episode';
      if (q.parentTmdbId) params.parent_tmdb_id = String(q.parentTmdbId);
      else if (q.parentImdbId) params.parent_imdb_id = q.parentImdbId.replace(/^tt/, '');
      if (q.season !== null && q.season !== undefined) params.season_number = String(q.season);
      if (q.episode !== null && q.episode !== undefined) params.episode_number = String(q.episode);
    } else {
      params.type = 'movie';
      if (q.tmdbId) params.tmdb_id = String(q.tmdbId);
      else if (q.imdbId) params.imdb_id = q.imdbId.replace(/^tt/, '');
      if (q.year) params.year = String(q.year);
    }
    const hasId = Boolean(params.tmdb_id || params.imdb_id || params.parent_tmdb_id || params.parent_imdb_id);
    if (!hasId && q.query) params.query = q.query.toLowerCase();
    if (!hasId && !q.query && !q.hash) return [];
    // The API asks for parameters in alphabetical order (other orders are redirected).
    const search = new URLSearchParams(Object.keys(params).sort().map((k): [string, string] => [k, params[k]!]));
    const { base, token } = await this.session(creds);
    const r = await this.call<{ data?: ApiSubtitle[] }>(`${base}/subtitles?${search}`, { method: 'GET', headers: this.headers(creds.apiKey, token) });
    const out: OnlineSubtitle[] = [];
    for (const item of r.data ?? []) {
      const a = item.attributes;
      // Subtitles split over several files (old CD releases) cannot be used for one video file.
      if (!a || a.files?.length !== 1 || typeof a.files[0]!.file_id !== 'number') continue;
      out.push({
        fileId: a.files[0]!.file_id!,
        language: (a.language ?? q.language).toLowerCase(),
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

  /** Downloads one subtitle file as SubRip text (bytes; the caller decodes them). */
  async download(fileId: number): Promise<{ data: Buffer; remaining: number | null }> {
    const creds = this.credentials();
    const { base, token } = await this.session(creds);
    const r = await this.call<{ link?: string; remaining?: number }>(`${base}/download`, {
      method: 'POST',
      headers: this.headers(creds.apiKey, token),
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
    });
    if (!r.link || !/^https:\/\//.test(r.link)) throw new OpenSubtitlesError('OpenSubtitles did not return a download.', 'failed');
    let res: Response;
    try {
      res = await this.fetchImpl(r.link, { signal: AbortSignal.timeout(20000) });
    } catch (err) {
      throw new OpenSubtitlesError(`OpenSubtitles could not be reached: ${(err as Error).message}`, 'unreachable');
    }
    if (!res.ok) throw new OpenSubtitlesError(`OpenSubtitles returned ${res.status}`, 'failed', res.status);
    const data = Buffer.from(await res.arrayBuffer());
    log.debug(`Downloaded subtitle file ${fileId} (${data.length} bytes, ${r.remaining ?? '?'} downloads left today)`);
    return { data, remaining: typeof r.remaining === 'number' ? r.remaining : null };
  }
}
