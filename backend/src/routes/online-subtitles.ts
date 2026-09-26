import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { episodes, libraries, mediaFiles, movies, onlineSubtitles, shows } from '../db/schema.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { canSee } from '../services/access.js';
import { resolveMediaPath } from '../services/paths.js';
import { decodeSubtitle, shiftVtt, srtToVtt } from '../services/subtitles.js';
import { ONLINE_SUBTITLE_LANGUAGES, OpenSubtitlesError, isOnlineSubtitleLanguage, movieHash, type OnlineSubtitle, type SubtitleQuery } from '../services/opensubtitles.js';
import { requestLanguage, type Language } from '../i18n/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('subtitles');

/** Largest subtitle file accepted from the provider. */
const MAX_BYTES = 2 * 1024 * 1024;
/** How long search results are reused for the same file and language. */
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
/** Searches one account may start per minute (results are cached, so this only stops floods). */
const SEARCHES_PER_MINUTE = 20;

const settingsBody = z.object({
  apiKey: z.string().trim().max(200).optional(),
  username: z.string().trim().max(100).optional(),
  password: z.string().max(200).optional(),
});
const searchQuery = z.object({ language: z.string().trim().toLowerCase().refine(isOnlineSubtitleLanguage, 'Choose a language from the list.') });
const downloadBody = z.object({ fileId: z.number().int().positive().max(2 ** 31) });

type OnlineRow = typeof onlineSubtitles.$inferSelect;

/** How a fetched subtitle appears among a file's subtitles (same shape as the other kinds). */
export function onlineSubtitleOption(row: OnlineRow, user: { id: number; role: 'admin' | 'user' }) {
  return {
    key: `onl-${row.id}`,
    kind: 'online' as const,
    label: row.release || row.language,
    language: row.language,
    languageName: null,
    title: row.hearingImpaired ? 'SDH' : null,
    forced: row.forced,
    isDefault: false,
    url: `/api/online-subtitles/${row.id}.vtt`,
    // The person who fetched it (or an administrator) may take it away again.
    removable: user.role === 'admin' || row.createdBy === user.id,
  };
}

/** The error a person sees for a provider problem, in their language. */
function providerError(err: unknown, lang: Language): HttpError {
  if (!(err instanceof OpenSubtitlesError)) return new HttpError(502, 'Searching subtitles online failed.');
  switch (err.kind) {
    case 'not-configured':
      return new HttpError(409, 'Searching subtitles online is not set up. An administrator can add an OpenSubtitles API key in Admin → Server.');
    case 'auth':
      return new HttpError(502, 'OpenSubtitles did not accept the API key or account. An administrator can check them in Admin → Server.');
    case 'quota':
      return err.resetAt
        ? new HttpError(429, 'The daily download limit at OpenSubtitles has been reached. Try again after {time}.', { time: new Date(err.resetAt).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) })
        : new HttpError(429, 'The daily download limit at OpenSubtitles has been reached. Try again tomorrow.');
    case 'unreachable':
      return new HttpError(502, 'OpenSubtitles could not be reached. Try again later.');
    default:
      return new HttpError(502, 'Searching subtitles online failed.');
  }
}

export async function onlineSubtitleRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const dir = ctx.config.onlineSubtitleDir;
  const client = ctx.openSubtitles;
  const results = new Map<string, { at: number; list: OnlineSubtitle[] }>();
  const hashes = new Map<string, string | null>();
  const searches = new Map<number, number[]>();

  /** A media file the user may see, with what it is (movie or episode). */
  function loadFile(idParam: string, user: { id: number; role: 'admin' | 'user' }) {
    const row = db
      .select({ f: mediaFiles, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(eq(mediaFiles.id, parseId(idParam)))
      .get();
    if (!row || !canSee(ctx.access.scope(user), row.f.libraryId)) throw notFound('Media file');
    return row;
  }

  async function queryFor(file: typeof mediaFiles.$inferSelect, root: string, language: SubtitleQuery['language']): Promise<SubtitleQuery> {
    const abs = resolveMediaPath(root, file.path);
    const hashKey = `${file.id}:${file.size}:${file.mtimeMs}`;
    if (!hashes.has(hashKey) && abs) {
      if (hashes.size > 2000) hashes.clear();
      hashes.set(hashKey, await movieHash(abs).catch(() => null));
    }
    const hash = hashes.get(hashKey) ?? null;
    if (file.movieId) {
      const m = db.select().from(movies).where(eq(movies.id, file.movieId)).get();
      return { language, hash, type: 'movie', tmdbId: m?.tmdbId, imdbId: m?.imdbId, query: m?.title ?? m?.parsedTitle, year: m?.year };
    }
    const e = file.episodeId ? db.select({ e: episodes, s: shows }).from(episodes).innerJoin(shows, eq(shows.id, episodes.showId)).where(eq(episodes.id, file.episodeId)).get() : undefined;
    return { language, hash, type: 'episode', parentTmdbId: e?.s.tmdbId, parentImdbId: e?.s.imdbId, season: e?.e.seasonNumber, episode: e?.e.episodeNumber, query: e ? `${e.s.title} S${String(e.e.seasonNumber).padStart(2, '0')}E${String(e.e.episodeNumber).padStart(2, '0')}` : null };
  }

  function allowSearch(userId: number): boolean {
    const now = Date.now();
    const recent = (searches.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= SEARCHES_PER_MINUTE) return false;
    recent.push(now);
    searches.set(userId, recent);
    return true;
  }

  // Files whose media file left the library (the rows went with it) are removed at start-up.
  void (async () => {
    try {
      const known = new Set(db.select({ n: onlineSubtitles.fileName }).from(onlineSubtitles).all().map((r) => r.n));
      for (const name of await fsp.readdir(dir)) if (name.endsWith('.vtt') && !known.has(name)) await fsp.rm(path.join(dir, name), { force: true });
    } catch (err) {
      log.warn('Could not tidy the online subtitles folder', err);
    }
  })();

  // ---------------------------------------------------------------- administrator settings
  const settingsView = () => {
    const s = ctx.settings.get();
    return {
      configured: Boolean(s.openSubtitlesApiKey),
      // Never the key or password themselves.
      hint: s.openSubtitlesApiKey ? `••••${s.openSubtitlesApiKey.slice(-4)}` : null,
      username: s.openSubtitlesUsername || null,
      hasPassword: Boolean(s.openSubtitlesPassword),
      languages: ONLINE_SUBTITLE_LANGUAGES,
    };
  };

  app.get('/api/admin/online-subtitles', { preHandler: requireAdmin }, async () => settingsView());

  app.put('/api/admin/online-subtitles', { preHandler: requireAdmin }, async (request) => {
    const body = settingsBody.parse(request.body);
    const current = ctx.settings.get();
    if (body.apiKey === '') {
      // Turning it off forgets the account as well.
      for (const k of ['openSubtitlesApiKey', 'openSubtitlesUsername', 'openSubtitlesPassword'] as const) ctx.settings.delete(k);
      client.reset();
      results.clear();
      ctx.audit.record('subtitles.settings', { actor: request.user, ip: request.ip, detail: 'OpenSubtitles turned off' });
      return settingsView();
    }
    const next = {
      apiKey: body.apiKey ?? current.openSubtitlesApiKey,
      username: body.username ?? current.openSubtitlesUsername,
      // A new username without a password clears the old password.
      password: body.password ?? (body.username !== undefined && body.username !== current.openSubtitlesUsername ? '' : current.openSubtitlesPassword),
    };
    if (!next.apiKey) throw new HttpError(400, 'Enter an OpenSubtitles API key.');
    if (Boolean(next.username) !== Boolean(next.password)) throw new HttpError(400, 'Enter both the username and the password of the OpenSubtitles account, or neither.');
    try {
      await client.verify(next);
    } catch (err) {
      if (err instanceof OpenSubtitlesError && err.kind === 'bad-key') throw new HttpError(400, 'OpenSubtitles did not accept this API key ({reason}).', { reason: err.message });
      if (err instanceof OpenSubtitlesError && err.kind === 'bad-account') {
        throw new HttpError(400, 'OpenSubtitles did not accept this username or password ({reason}).', { reason: err.message });
      }
      throw providerError(err, requestLanguage(request));
    }
    ctx.settings.update({ openSubtitlesApiKey: next.apiKey, openSubtitlesUsername: next.username, openSubtitlesPassword: next.password });
    client.reset();
    results.clear();
    const changes = [body.apiKey !== undefined ? 'API key changed' : null, body.username !== undefined ? (next.username ? 'account set' : 'account removed') : null].filter(Boolean);
    ctx.audit.record('subtitles.settings', { actor: request.user, ip: request.ip, detail: changes.join('; ') || 'verified' });
    return settingsView();
  });

  // ---------------------------------------------------------------- search and fetch
  app.get<{ Params: { id: string } }>('/api/media/:id/subtitles/online', { preHandler: requireUser }, async (request) => {
    const { f, root } = loadFile(request.params.id, request.user!);
    const { language } = searchQuery.parse(request.query);
    const lang = requestLanguage(request);
    if (!client.configured) throw providerError(new OpenSubtitlesError('', 'not-configured'), lang);
    const key = `${f.id}:${language}`;
    let cached = results.get(key);
    if (!cached || Date.now() - cached.at > SEARCH_TTL_MS) {
      if (!allowSearch(request.user!.id)) throw new HttpError(429, 'Too many searches at once. Wait a moment and try again.');
      try {
        cached = { at: Date.now(), list: (await client.search(await queryFor(f, root, language as SubtitleQuery['language']))).slice(0, 30) };
      } catch (err) {
        throw providerError(err, lang);
      }
      if (results.size > 1000) results.clear();
      results.set(key, cached);
    }
    const fetched = new Map(db.select().from(onlineSubtitles).where(eq(onlineSubtitles.mediaFileId, f.id)).all().map((r) => [r.providerFileId, r]));
    return {
      language,
      results: cached.list.map((r) => {
        const row = fetched.get(r.fileId);
        return { ...r, fetched: row ? onlineSubtitleOption(row, request.user!) : null };
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/media/:id/subtitles/online', { preHandler: requireUser }, async (request) => {
    const { f } = loadFile(request.params.id, request.user!);
    const { fileId } = downloadBody.parse(request.body);
    const lang = requestLanguage(request);
    const existing = db.select().from(onlineSubtitles).where(and(eq(onlineSubtitles.mediaFileId, f.id), eq(onlineSubtitles.providerFileId, fileId))).get();
    if (existing && fs.existsSync(path.join(dir, existing.fileName))) return onlineSubtitleOption(existing, request.user!);
    // Only subtitles that a search for this file offered (so nobody spends the daily downloads on other things).
    const offered = [...results.entries()].filter(([k]) => k.startsWith(`${f.id}:`)).flatMap(([, v]) => v.list).find((r) => r.fileId === fileId);
    if (!offered) throw new HttpError(400, 'Search for subtitles for this file first.');
    let data: Buffer;
    try {
      data = (await client.download(fileId)).data;
    } catch (err) {
      throw providerError(err, lang);
    }
    if (data.length > MAX_BYTES) throw new HttpError(502, 'This subtitle file is too large.');
    const text = decodeSubtitle(data);
    const vtt = text.trimStart().startsWith('WEBVTT') ? text : srtToVtt(text);
    if (!vtt.includes('-->')) throw new HttpError(502, 'This subtitle file could not be read.');
    const fileName = `${f.id}-${fileId}.vtt`;
    await fsp.writeFile(path.join(dir, fileName), vtt);
    const values = { mediaFileId: f.id, providerFileId: fileId, language: offered.language, release: offered.release || null, hearingImpaired: offered.hearingImpaired, forced: offered.forced, fileName, createdBy: request.user!.id };
    const row = existing
      ? db.update(onlineSubtitles).set(values).where(eq(onlineSubtitles.id, existing.id)).returning().get()
      : db.insert(onlineSubtitles).values(values).returning().get();
    ctx.audit.record('subtitles.downloaded', { actor: request.user, ip: request.ip, target: path.basename(f.path), detail: `${offered.language}: ${offered.release}`.slice(0, 200) });
    return onlineSubtitleOption(row, request.user!);
  });

  app.get<{ Params: { id: string } }>('/api/online-subtitles/:id.vtt', { preHandler: requireUser }, async (request, reply) => {
    const row = db
      .select({ s: onlineSubtitles, libraryId: mediaFiles.libraryId })
      .from(onlineSubtitles)
      .innerJoin(mediaFiles, eq(mediaFiles.id, onlineSubtitles.mediaFileId))
      .where(eq(onlineSubtitles.id, parseId(request.params.id)))
      .get();
    if (!row || !canSee(ctx.access.scope(request.user!), row.libraryId)) throw notFound('Subtitle');
    let vtt: string;
    try {
      vtt = await fsp.readFile(path.join(dir, row.s.fileName), 'utf8');
    } catch {
      throw notFound('Subtitle');
    }
    const raw = (request.query as { offset?: string }).offset;
    const offset = raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(offset) || offset < 0 || offset > 1e6) throw new HttpError(400, 'Invalid subtitle offset.');
    return reply.type('text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(shiftVtt(vtt, offset));
  });

  app.delete<{ Params: { id: string } }>('/api/online-subtitles/:id', { preHandler: requireUser }, async (request) => {
    const row = db
      .select({ s: onlineSubtitles, libraryId: mediaFiles.libraryId, path: mediaFiles.path })
      .from(onlineSubtitles)
      .innerJoin(mediaFiles, eq(mediaFiles.id, onlineSubtitles.mediaFileId))
      .where(eq(onlineSubtitles.id, parseId(request.params.id)))
      .get();
    if (!row || !canSee(ctx.access.scope(request.user!), row.libraryId)) throw notFound('Subtitle');
    if (request.user!.role !== 'admin' && row.s.createdBy !== request.user!.id) throw new HttpError(403, 'Only the person who fetched this subtitle or an administrator can remove it.');
    db.delete(onlineSubtitles).where(eq(onlineSubtitles.id, row.s.id)).run();
    await fsp.rm(path.join(dir, row.s.fileName), { force: true });
    ctx.audit.record('subtitles.removed', { actor: request.user, ip: request.ip, target: path.basename(row.path), detail: `${row.s.language}: ${row.s.release ?? ''}`.slice(0, 200) });
    return { ok: true };
  });

}
