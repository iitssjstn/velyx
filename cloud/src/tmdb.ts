import type { FastifyInstance, FastifyRequest } from 'fastify';
import { count, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { serviceSettings, tmdbCache } from './db/schema.js';

/**
 * Metadata for linked Vidalune servers, with one TMDB key for everyone (set by the CEO in the
 * Control Center, stored in the database and never shown again), so nobody has to bring their own.
 * Servers ask what they would ask TMDB themselves; only the questions Vidalune asks are passed on,
 * and every answer is reused for a day by every server. Images do not come through here: servers
 * fetch those from TMDB's image host themselves. Nothing about users or what anyone watches is sent.
 */

const API_BASE = 'https://api.themoviedb.org/3';
/** How long an answer is reused for the same question. */
export const TMDB_TTL_MS = 24 * 60 * 60 * 1000;
/** Something TMDB does not have is asked again sooner (it may be added). */
export const TMDB_MISSING_TTL_MS = 60 * 60 * 1000;
/** Requests to TMDB start at most this often (TMDB allows about 50 a second). */
const MIN_INTERVAL_MS = 25;
/** At most this many requests to TMDB at the same time. */
const MAX_PARALLEL = 8;
/** More questions waiting than this: "busy, ask again later" instead of an ever longer queue. */
const MAX_WAITING = 2000;

export class TmdbProxyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const language = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
const flag = z.enum(['true', 'false']);
const year = z.coerce.number().int().min(1870).max(2200);
const search = z.object({ query: z.string().trim().min(1).max(200), year: year.optional(), first_air_date_year: year.optional(), include_adult: flag.optional(), language: language.optional() }).strict();
const details = z.object({ append_to_response: z.string().regex(/^(credits|external_ids|translations)(,(credits|external_ids|translations)){0,2}$/).optional(), language: language.optional() }).strict();
const onlyLanguage = z.object({ language: language.optional() }).strict();
const nothing = z.object({}).strict();
const videos = z.object({ language: language.optional(), include_video_language: z.string().regex(/^[a-z]{2}(,[a-z]{2}|,null){0,4}$/).optional() }).strict();

/** The questions Vidalune asks TMDB (the paths of the server's TMDB client), each with the parameters it may carry. */
const ALLOWED: Array<{ path: RegExp; params: z.ZodType<Record<string, unknown>> }> = [
  { path: /^\/search\/(movie|tv)$/, params: search },
  { path: /^\/(movie|tv)\/\d{1,10}$/, params: details },
  { path: /^\/tv\/\d{1,10}\/season\/\d{1,4}$/, params: onlyLanguage },
  { path: /^\/(movie|tv)\/\d{1,10}\/translations$/, params: nothing },
  { path: /^\/(movie|tv)\/\d{1,10}\/videos$/, params: videos },
];

export const tmdbQuestion = z.object({
  path: z.string().max(100),
  params: z.record(z.string().max(40), z.union([z.string().max(300), z.number()])).default({}),
});

/**
 * The cache key of an allowed question: its path and parameters in alphabetical order. Throws 400
 * for anything Vidalune does not ask (other paths, other parameters, odd values).
 */
export function questionKey(q: z.infer<typeof tmdbQuestion>): string {
  const rule = ALLOWED.find((r) => r.path.test(q.path));
  if (!rule) throw new TmdbProxyError(400, 'This is not something Vidalune asks TMDB.');
  // Ids in paths are numbers only (checked above); a leading zero would only split the cache.
  if (/\/0\d/.test(q.path)) throw new TmdbProxyError(400, 'This is not something Vidalune asks TMDB.');
  const parsed = rule.params.safeParse(Object.fromEntries(Object.entries(q.params).map(([k, v]) => [k, String(v)])));
  if (!parsed.success) throw new TmdbProxyError(400, 'This is not something Vidalune asks TMDB.');
  const params = new URLSearchParams(
    Object.keys(parsed.data)
      .filter((k) => parsed.data[k] !== undefined)
      .sort()
      .map((k): [string, string] => [k, String(parsed.data[k])]),
  );
  const tail = params.toString();
  return tail ? `${q.path}?${tail}` : q.path;
}

const SETTING = 'tmdb';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TmdbProxy {
  private saved: { apiKey: string } | null | undefined;
  private nextStart = 0;
  private running = 0;
  private waiting: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<{ status: number; body: string }>>();

  constructor(private readonly deps: { db: DB; fetchImpl: typeof fetch; now: () => number; log?: (message: string) => void }) {}

  /** The key set in the Control Center (null: metadata through vidalune.com is not offered). */
  key(): string | null {
    if (this.saved === undefined) {
      const row = this.deps.db.select().from(serviceSettings).where(eq(serviceSettings.key, SETTING)).get();
      this.saved = row ? (JSON.parse(row.value) as { apiKey: string }) : null;
    }
    return this.saved?.apiKey || null;
  }

  get available(): boolean {
    return !!this.key();
  }

  /** Stores a checked key (null: turn it off). */
  save(apiKey: string | null, by: string): void {
    const { db } = this.deps;
    if (apiKey) {
      const value = JSON.stringify({ apiKey });
      db.insert(serviceSettings).values({ key: SETTING, value, updatedAt: this.deps.now(), updatedBy: by }).onConflictDoUpdate({ target: serviceSettings.key, set: { value, updatedAt: this.deps.now(), updatedBy: by } }).run();
    } else db.delete(serviceSettings).where(eq(serviceSettings.key, SETTING)).run();
    this.saved = apiKey ? { apiKey } : null;
  }

  private url(key: string, apiKey: string): { url: string; headers: Record<string, string> } {
    const url = new URL(API_BASE + key);
    const headers: Record<string, string> = { Accept: 'application/json' };
    // v4 "API Read Access Tokens" are JWTs; v3 keys are 32-character hex strings.
    if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
    else url.searchParams.set('api_key', apiKey);
    return { url: url.toString(), headers };
  }

  /** Checks a key at TMDB before it is saved. */
  async verify(apiKey: string): Promise<void> {
    const { url, headers } = this.url('/configuration', apiKey);
    let res: Response;
    try {
      res = await this.deps.fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new TmdbProxyError(502, 'TMDB could not be reached.');
    }
    if (res.status === 401 || res.status === 403) throw new TmdbProxyError(400, 'TMDB did not accept this API key.');
    if (!res.ok) throw new TmdbProxyError(502, `TMDB answered ${res.status}.`);
  }

  /** Waits for a turn: requests start spaced out and only a few run at once. */
  private async turn(): Promise<() => void> {
    if (this.running >= MAX_PARALLEL) {
      if (this.waiting.length >= MAX_WAITING) throw new TmdbProxyError(503, 'Metadata through Vidalune is busy right now. Try again in a moment.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    const now = Date.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + MIN_INTERVAL_MS;
    if (start > now) await sleep(start - now);
    return () => {
      this.running--;
      this.waiting.shift()?.();
    };
  }

  private async fetchAnswer(key: string): Promise<{ status: number; body: string }> {
    const apiKey = this.key();
    if (!apiKey) throw new TmdbProxyError(503, 'Metadata through Vidalune is not available right now.');
    const { url, headers } = this.url(key, apiKey);
    for (let attempt = 0; ; attempt++) {
      const done = await this.turn();
      let res: Response;
      try {
        res = await this.deps.fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
      } catch {
        done();
        if (attempt >= 2) throw new TmdbProxyError(502, 'TMDB could not be reached.');
        await sleep(500 * (attempt + 1));
        continue;
      }
      done();
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || attempt + 1, 10);
        await sleep(wait * 1000);
        continue;
      }
      const body = await res.text();
      if (res.status === 401) {
        // The key in the Control Center stopped working: that is ours to fix, not the server's.
        this.deps.log?.('TMDB did not accept the key of vidalune.com (Control Center > TMDB).');
        throw new TmdbProxyError(503, 'Metadata through Vidalune is not available right now.');
      }
      if (res.status === 200 || res.status === 404) {
        try {
          JSON.parse(body);
        } catch {
          throw new TmdbProxyError(502, 'TMDB returned an unusable answer.');
        }
        return { status: res.status, body };
      }
      throw new TmdbProxyError(502, `TMDB answered ${res.status}.`);
    }
  }

  /** TMDB's answer to an allowed question: from here when any server asked it in the last day. */
  async answer(key: string): Promise<{ status: number; body: string }> {
    const { db } = this.deps;
    const now = this.deps.now();
    const cached = db.select().from(tmdbCache).where(eq(tmdbCache.key, key)).get();
    if (cached && now - cached.fetchedAt < (cached.status === 200 ? TMDB_TTL_MS : TMDB_MISSING_TTL_MS)) return { status: cached.status, body: cached.body };
    // The same question from several servers at once goes to TMDB once.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetchAnswer(key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const fresh = await pending;
    const at = this.deps.now();
    db.insert(tmdbCache).values({ key, ...fresh, fetchedAt: at }).onConflictDoUpdate({ target: tmdbCache.key, set: { ...fresh, fetchedAt: at } }).run();
    // Old answers are let go now and then.
    if (Math.random() < 0.01) db.delete(tmdbCache).where(lt(tmdbCache.fetchedAt, at - TMDB_TTL_MS)).run();
    return fresh;
  }

  /** How many answers are kept. */
  kept(): number {
    return this.deps.db.select({ n: count() }).from(tmdbCache).get()?.n ?? 0;
  }
}

export function tmdbRoutes(
  app: FastifyInstance,
  deps: {
    proxy: TmdbProxy;
    /** The CEO of Vidalune, signed in; throws otherwise. */
    ceo: (request: FastifyRequest) => { email: string };
    /** The asking server; it must be linked to a Vidalune account. */
    server: (request: FastifyRequest) => { id: string; accountId: number | null };
    /** Throws 429 when someone asks too often (`key` says for what). */
    limit: (key: string) => void;
  },
): void {
  const { proxy } = deps;

  // ---- the Control Center: the key (write-only)
  const view = () => {
    const key = proxy.key();
    // Never the key itself.
    return { configured: !!key, hint: key ? `••••${key.slice(-4)}` : null, kept: proxy.kept() };
  };
  app.get('/api/ceo/tmdb', async (request) => {
    deps.ceo(request);
    return view();
  });
  app.put('/api/ceo/tmdb', async (request) => {
    const me = deps.ceo(request);
    deps.limit(`tmdb-settings:${me.email}`);
    const { apiKey } = z.object({ apiKey: z.string().trim().min(1).max(400) }).parse(request.body);
    await proxy.verify(apiKey);
    proxy.save(apiKey, me.email);
    return view();
  });
  app.delete('/api/ceo/tmdb', async (request) => {
    const me = deps.ceo(request);
    proxy.save(null, me.email);
    return view();
  });

  // ---- servers: TMDB's answer, as TMDB gave it (its status and JSON)
  app.post('/api/tmdb', async (request, reply) => {
    const me = deps.server(request);
    if (!me.accountId) throw new TmdbProxyError(403, 'Link this server to a Vidalune account to get metadata through Vidalune.');
    if (!proxy.available) throw new TmdbProxyError(503, 'Metadata through Vidalune is not available right now.');
    const key = questionKey(tmdbQuestion.parse(request.body));
    deps.limit(`tmdb:${me.id}`);
    const { status, body } = await proxy.answer(key);
    // TMDB's JSON goes on as it is, without reading it in and writing it out again.
    return reply.type('application/json').send(`{"status":${status},"data":${body}}`);
  });
}
