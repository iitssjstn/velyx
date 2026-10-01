import type { FastifyInstance, FastifyRequest } from 'fastify';
import { count, eq, lt, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { serviceSettings, subtitleFiles, subtitleSearches } from './db/schema.js';

/**
 * Online subtitles for linked Vidalune servers, with one OpenSubtitles key for everyone (set by the
 * CEO in the Control Center, stored in the database and never shown again, so nobody has to bring
 * their own). Servers send what a file is (ids, season and
 * episode, its OpenSubtitles hash) and get the matching subtitles; downloaded files are kept here,
 * so the next server that wants the same file gets it without a new download at OpenSubtitles.
 * Nothing about users or what anyone watches is sent or kept.
 */

const API_BASE = 'https://api.opensubtitles.com/api/v1';
/** How long search results are reused for the same question. */
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
/** Largest subtitle file accepted from the provider. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface OpenSubtitlesAccount {
  apiKey: string;
  username: string;
  password: string;
}

export class SubtitleError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}(-[a-z]{2})?$/);
const id = z.number().int().positive().max(2 ** 31).nullable().optional();
export const subtitleQuery = z.object({
  language,
  hash: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable()
    .optional(),
  type: z.enum(['movie', 'episode']),
  tmdbId: id,
  imdbId: z
    .string()
    .regex(/^(tt)?\d{1,10}$/)
    .nullable()
    .optional(),
  parentTmdbId: id,
  parentImdbId: z
    .string()
    .regex(/^(tt)?\d{1,10}$/)
    .nullable()
    .optional(),
  season: z.number().int().min(0).max(1000).nullable().optional(),
  episode: z.number().int().min(0).max(10_000).nullable().optional(),
  query: z.string().trim().max(200).nullable().optional(),
  year: z.number().int().min(1870).max(2200).nullable().optional(),
});
export type SubtitleQuery = z.infer<typeof subtitleQuery>;

/** The search at OpenSubtitles for a question (parameters in alphabetical order, as the API asks). */
export function searchParams(q: SubtitleQuery): URLSearchParams | null {
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
  if (!hasId && !q.query && !q.hash) return null;
  return new URLSearchParams(Object.keys(params).sort().map((k): [string, string] => [k, params[k]!]));
}

const SETTING = 'opensubtitles';

export class SubtitleProxy {
  private token: { value: string; base: string; until: number } | null = null;
  private saved: OpenSubtitlesAccount | null | undefined;

  constructor(private readonly deps: { db: DB; fetchImpl: typeof fetch; now: () => number; userAgent: string }) {}

  /** The key and account set in the Control Center (null: subtitles are not offered). */
  account(): OpenSubtitlesAccount | null {
    if (this.saved === undefined) {
      const row = this.deps.db.select().from(serviceSettings).where(eq(serviceSettings.key, SETTING)).get();
      this.saved = row ? (JSON.parse(row.value) as OpenSubtitlesAccount) : null;
    }
    return this.saved;
  }

  /** Stores a checked key and account (null: turn subtitles off). */
  save(account: OpenSubtitlesAccount | null, by: string): void {
    const { db } = this.deps;
    if (account) {
      const value = JSON.stringify(account);
      db.insert(serviceSettings).values({ key: SETTING, value, updatedAt: this.deps.now(), updatedBy: by }).onConflictDoUpdate({ target: serviceSettings.key, set: { value, updatedAt: this.deps.now(), updatedBy: by } }).run();
    } else db.delete(serviceSettings).where(eq(serviceSettings.key, SETTING)).run();
    this.saved = account;
    this.token = null;
  }

  get available(): boolean {
    return Boolean(this.account()?.apiKey);
  }

  /**
   * Checks a key, then the account, before they are saved: a small search (it needs a valid key and
   * costs no downloads), then signing in.
   */
  async verify(account: OpenSubtitlesAccount): Promise<void> {
    const headers = this.headers(undefined, account.apiKey);
    let res: Response;
    try {
      res = await this.deps.fetchImpl(`${API_BASE}/subtitles?languages=en&query=vidalune&type=movie`, { headers, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new SubtitleError(502, 'OpenSubtitles could not be reached.');
    }
    if (res.status === 401 || res.status === 403) throw new SubtitleError(400, 'OpenSubtitles did not accept this API key.');
    if (!res.ok) throw new SubtitleError(502, `OpenSubtitles answered ${res.status}.`);
    if (!account.username || !account.password) return;
    try {
      res = await this.deps.fetchImpl(`${API_BASE}/login`, { method: 'POST', headers, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(15000) });
    } catch {
      throw new SubtitleError(502, 'OpenSubtitles could not be reached.');
    }
    const body = (await res.json().catch(() => null)) as { token?: string } | null;
    if (!res.ok || !body?.token) throw new SubtitleError(400, 'OpenSubtitles did not accept this username and password.');
  }

  private headers(token?: string, apiKey = this.account()!.apiKey): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      'User-Agent': this.deps.userAgent,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.deps.fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new SubtitleError(502, 'OpenSubtitles could not be reached.');
    }
    const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (res.status === 401) this.token = null;
    if (res.status === 406 || res.status === 429) throw new SubtitleError(429, 'The daily download limit at OpenSubtitles has been reached.');
    if (!res.ok || !body || typeof body !== 'object') throw new SubtitleError(502, `OpenSubtitles answered ${res.status}.`);
    return body;
  }

  /** Signs in with the account (when one is set): more downloads, and VIP members get their own host. */
  private async session(): Promise<{ base: string; token?: string }> {
    const a = this.account()!;
    if (!a.username || !a.password) return { base: API_BASE };
    if (this.token && this.token.until > this.deps.now()) return { base: this.token.base, token: this.token.value };
    const r = await this.call<{ token?: string; base_url?: string }>(`${API_BASE}/login`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ username: a.username, password: a.password }) });
    if (!r.token) throw new SubtitleError(502, 'OpenSubtitles did not accept the account.');
    const base = r.base_url && /^[a-z0-9.-]+$/i.test(r.base_url) ? `https://${r.base_url}/api/v1` : API_BASE;
    this.token = { value: r.token, base, until: this.deps.now() + 23 * 60 * 60 * 1000 };
    return { base, token: r.token };
  }

  /** Runs a request with the account's session; once more with a new one when OpenSubtitles ended it early. */
  private async signedIn<T>(run: (s: { base: string; token?: string }) => Promise<T>): Promise<T> {
    const s = await this.session();
    try {
      return await run(s);
    } catch (err) {
      // `call` forgets the token on a 401: sign in again and try once more.
      if (s.token && this.token === null) return run(await this.session());
      throw err;
    }
  }

  /** What OpenSubtitles has for this question (its answer, reused for a day). */
  async search(q: SubtitleQuery): Promise<unknown[]> {
    const params = searchParams(q);
    if (!params) return [];
    const key = params.toString();
    const { db } = this.deps;
    const now = this.deps.now();
    const cached = db.select().from(subtitleSearches).where(eq(subtitleSearches.key, key)).get();
    if (cached && now - cached.fetchedAt < SEARCH_TTL_MS) return JSON.parse(cached.results) as unknown[];
    const r = await this.signedIn(({ base, token }) => this.call<{ data?: unknown[] }>(`${base}/subtitles?${params}`, { method: 'GET', headers: this.headers(token) }));
    const data = Array.isArray(r.data) ? r.data : [];
    db.insert(subtitleSearches).values({ key, results: JSON.stringify(data), fetchedAt: now }).onConflictDoUpdate({ target: subtitleSearches.key, set: { results: JSON.stringify(data), fetchedAt: now } }).run();
    // Old answers are let go now and then.
    if (Math.random() < 0.02) db.delete(subtitleSearches).where(lt(subtitleSearches.fetchedAt, now - SEARCH_TTL_MS)).run();
    return data;
  }

  /** Whether the file is kept here already (getting it costs nothing at OpenSubtitles). */
  has(fileId: number): boolean {
    return !!this.deps.db.select({ fileId: subtitleFiles.fileId }).from(subtitleFiles).where(eq(subtitleFiles.fileId, fileId)).get();
  }

  /** One subtitle file (SubRip): from here when another server fetched it before. */
  async download(fileId: number): Promise<Buffer> {
    const { db } = this.deps;
    const kept = db.select().from(subtitleFiles).where(eq(subtitleFiles.fileId, fileId)).get();
    if (kept) {
      db.update(subtitleFiles).set({ served: sql`${subtitleFiles.served} + 1` }).where(eq(subtitleFiles.fileId, fileId)).run();
      return kept.data;
    }
    const r = await this.signedIn(({ base, token }) => this.call<{ link?: string }>(`${base}/download`, { method: 'POST', headers: this.headers(token), body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }) }));
    if (!r.link || !/^https:\/\//.test(r.link)) throw new SubtitleError(502, 'OpenSubtitles did not return a download.');
    let res: Response;
    try {
      res = await this.deps.fetchImpl(r.link, { signal: AbortSignal.timeout(20000) });
    } catch {
      throw new SubtitleError(502, 'OpenSubtitles could not be reached.');
    }
    if (!res.ok) throw new SubtitleError(502, `OpenSubtitles answered ${res.status}.`);
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > MAX_BYTES) throw new SubtitleError(502, 'OpenSubtitles returned an unusable file.');
    db.insert(subtitleFiles).values({ fileId, data, fetchedAt: this.deps.now(), served: 1 }).onConflictDoNothing().run();
    return data;
  }
}

export function subtitleRoutes(
  app: FastifyInstance,
  deps: {
    db: DB;
    proxy: SubtitleProxy;
    /** The CEO (or an administrator) of Vidalune, signed in; throws otherwise. */
    ceo: (request: FastifyRequest) => { email: string };
    /** The asking server; it must be linked to a Vidalune account. */
    server: (request: FastifyRequest) => { id: string; accountId: number | null };
    /** Throws 429 when a server asks too often (`key` says for what). */
    limit: (key: string) => void;
  },
): void {
  const { proxy } = deps;
  const linked = (request: FastifyRequest) => {
    const me = deps.server(request);
    if (!me.accountId) throw new SubtitleError(403, 'Link this server to a Vidalune account to search subtitles through Vidalune.');
    if (!proxy.available) throw new SubtitleError(503, 'Subtitles through Vidalune are not available right now.');
    return me;
  };

  // ---- the Control Center: the key and account (write-only), and what was kept
  const settingsBody = z.object({
    apiKey: z.string().trim().max(200).optional(),
    username: z.string().trim().max(100).optional(),
    password: z.string().max(200).optional(),
  });
  const view = () => {
    const a = proxy.account();
    const kept = deps.db.select({ files: count(), served: sum(subtitleFiles.served) }).from(subtitleFiles).get();
    return {
      configured: !!a,
      // Never the key or password themselves.
      hint: a ? `••••${a.apiKey.slice(-4)}` : null,
      username: a?.username || null,
      hasPassword: !!a?.password,
      files: kept?.files ?? 0,
      served: Number(kept?.served ?? 0),
    };
  };
  app.get('/api/ceo/subtitles', async (request) => {
    deps.ceo(request);
    return view();
  });
  app.put('/api/ceo/subtitles', async (request) => {
    const me = deps.ceo(request);
    deps.limit(`subtitle-settings:${me.email}`);
    const body = settingsBody.parse(request.body);
    const current = proxy.account();
    const next: OpenSubtitlesAccount = {
      apiKey: body.apiKey || current?.apiKey || '',
      username: body.username ?? current?.username ?? '',
      // A new username without a password: the old password is for the old name.
      password: body.password || (body.username !== undefined && body.username !== current?.username ? '' : (current?.password ?? '')),
    };
    if (!next.apiKey) throw new SubtitleError(400, 'Enter an OpenSubtitles API key.');
    if (next.username && !next.password) throw new SubtitleError(400, 'Enter the password of this OpenSubtitles account.');
    await proxy.verify(next);
    proxy.save(next, me.email);
    return view();
  });
  app.delete('/api/ceo/subtitles', async (request) => {
    const me = deps.ceo(request);
    proxy.save(null, me.email);
    return view();
  });

  app.get('/api/subtitles/status', async (request) => {
    const me = deps.server(request);
    return { available: proxy.available && !!me.accountId };
  });

  app.post('/api/subtitles/search', async (request) => {
    const me = linked(request);
    deps.limit(`subtitle-search:${me.id}`);
    return { data: await proxy.search(subtitleQuery.parse(request.body)) };
  });

  app.post('/api/subtitles/download', async (request) => {
    const me = linked(request);
    const { fileId } = z.object({ fileId: z.number().int().positive().max(2 ** 31) }).parse(request.body);
    // Only new files count against a server's share of the daily downloads at OpenSubtitles.
    deps.limit(proxy.has(fileId) ? `subtitle-kept:${me.id}` : `subtitle-download:${me.id}`);
    const data = await proxy.download(fileId);
    return { data: data.toString('base64') };
  });
}
