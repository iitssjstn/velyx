import type { FastifyInstance } from 'fastify';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { episodes, episodeSegments, libraries, mediaFiles, shows } from '../db/schema.js';
import { HttpError, parseId } from '../http-error.js';
import { clearSegments, saveManualSegments } from '../services/segments/store.js';

const span = z
  .object({ start: z.number().min(0).max(86_400), end: z.number().min(0).max(86_400) })
  .refine((s) => s.end > s.start, 'The end must be after the start')
  .nullable();
const manualBody = z.object({ intro: span, credits: span, postCredits: span });
const analyzeBody = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('episode'), episodeId: z.number().int().positive() }),
  z.object({ scope: z.literal('season'), showId: z.number().int().positive(), seasonNumber: z.number().int().min(0).max(10_000) }),
  z.object({ scope: z.literal('show'), showId: z.number().int().positive() }),
  z.object({ scope: z.literal('all') }),
]);

type Row = typeof episodeSegments.$inferSelect;

function segmentView(row: Row | undefined) {
  if (!row) return null;
  const part = (start: number | null, end: number | null, confidence: Row['introConfidence'], source: Row['introSource'] = null) => (start !== null && end !== null ? { start, end, confidence, source } : null);
  return {
    status: row.status,
    error: row.error,
    intro: part(row.introStart, row.introEnd, row.introConfidence, row.introSource),
    credits: part(row.creditsStart, row.creditsEnd, row.creditsConfidence, row.creditsSource),
    postCredits: part(row.postCreditsStart, row.postCreditsEnd, null),
    method: row.method,
    manual: row.manual,
    version: row.version,
    detectedAt: row.detectedAt,
    fileId: row.mediaFileId,
  };
}

/** Intro & credits: status, results per show, manual corrections and re-analysis (admins only). */
export async function segmentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;

  app.get('/api/admin/segments', { preHandler: requireAdmin }, async () => {
    const status = ctx.segments.status();
    // Only episodes that can be analysed count (very short files and episodes without a file are left out).
    const eligible = ctx.segments.eligible();
    // Per show: episodes, analysed, found and failed, so admins can see where to look.
    const rows = db
      .select({ showId: shows.id, title: shows.title, posterPath: shows.posterPath, episodeId: episodes.id, seg: episodeSegments })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .innerJoin(libraries, eq(libraries.id, shows.libraryId))
      .leftJoin(episodeSegments, eq(episodeSegments.episodeId, episodes.id))
      .where(eq(libraries.type, 'shows'))
      .all();
    const byShow = new Map<number, { id: number; title: string; posterPath: string | null; episodes: number; analyzed: number; intros: number; credits: number; errors: number; manual: number; low: number }>();
    for (const r of rows) {
      if (!eligible.has(r.episodeId)) continue;
      let s = byShow.get(r.showId);
      if (!s) byShow.set(r.showId, (s = { id: r.showId, title: r.title, posterPath: r.posterPath, episodes: 0, analyzed: 0, intros: 0, credits: 0, errors: 0, manual: 0, low: 0 }));
      s.episodes++;
      const g = r.seg;
      if (!g) continue;
      if (g.status === 'error') s.errors++;
      else s.analyzed++;
      const ok = (c: Row['introConfidence']) => g.manual || c === 'high' || c === 'medium';
      if (g.introStart !== null && ok(g.introConfidence)) s.intros++;
      if (g.creditsStart !== null && ok(g.creditsConfidence)) s.credits++;
      if (g.manual) s.manual++;
      if (!g.manual && (g.introConfidence === 'low' || g.creditsConfidence === 'low')) s.low++;
    }
    const errors = db
      .select({ episodeId: episodeSegments.episodeId, error: episodeSegments.error, detectedAt: episodeSegments.detectedAt, showId: shows.id, showTitle: shows.title, seasonNumber: episodes.seasonNumber, episodeNumber: episodes.episodeNumber })
      .from(episodeSegments)
      .innerJoin(episodes, eq(episodes.id, episodeSegments.episodeId))
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(episodeSegments.status, 'error'))
      .orderBy(desc(episodeSegments.detectedAt))
      .limit(50)
      .all();
    return { status, shows: [...byShow.values()].sort((a, b) => a.title.localeCompare(b.title)), errors };
  });

  app.get<{ Params: { id: string } }>('/api/admin/segments/shows/:id', { preHandler: requireAdmin }, async (request) => {
    const showId = parseId(request.params.id);
    const show = db.select({ id: shows.id, title: shows.title }).from(shows).where(eq(shows.id, showId)).get();
    if (!show) throw new HttpError(404, 'Show not found.');
    const eps = db.select().from(episodes).where(eq(episodes.showId, showId)).orderBy(episodes.seasonNumber, episodes.episodeNumber).all();
    const ids = eps.map((e) => e.id);
    const segs = new Map(ids.length ? db.select().from(episodeSegments).where(inArray(episodeSegments.episodeId, ids)).all().map((r) => [r.episodeId, r]) : []);
    const files = ids.length
      ? db.select({ episodeId: mediaFiles.episodeId, id: mediaFiles.id, duration: mediaFiles.durationSec, height: mediaFiles.height }).from(mediaFiles).where(inArray(mediaFiles.episodeId, ids)).orderBy(desc(mediaFiles.height), mediaFiles.id).all()
      : [];
    const firstFile = new Map<number, (typeof files)[number]>();
    for (const f of files) if (f.episodeId !== null && !firstFile.has(f.episodeId)) firstFile.set(f.episodeId, f);
    const eligible = ctx.segments.eligible(showId);
    const seasons = new Map<number, Array<Record<string, unknown>>>();
    for (const e of eps) {
      if (!seasons.has(e.seasonNumber)) seasons.set(e.seasonNumber, []);
      seasons.get(e.seasonNumber)!.push({ id: e.id, episodeNumber: e.episodeNumber, title: e.title, duration: firstFile.get(e.id)?.duration ?? null, eligible: eligible.has(e.id), segments: segmentView(segs.get(e.id)) });
    }
    return { show, seasons: [...seasons.entries()].map(([seasonNumber, list]) => ({ seasonNumber, episodes: list })) };
  });

  app.put<{ Params: { id: string } }>('/api/admin/segments/episodes/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const body = manualBody.parse(request.body);
    const ep = db.select({ id: episodes.id, showId: episodes.showId, seasonNumber: episodes.seasonNumber, episodeNumber: episodes.episodeNumber }).from(episodes).where(eq(episodes.id, id)).get();
    if (!ep) throw new HttpError(404, 'Episode not found.');
    const file = db.select({ id: mediaFiles.id, size: mediaFiles.size, duration: mediaFiles.durationSec }).from(mediaFiles).where(eq(mediaFiles.episodeId, id)).orderBy(desc(mediaFiles.height), mediaFiles.id).get();
    const duration = file?.duration ?? null;
    for (const [name, s] of Object.entries(body)) {
      if (s && duration && s.end > duration + 1) throw new HttpError(400, `The ${name === 'postCredits' ? 'post-credits scene' : name} ends after the episode (${Math.round(duration)} s).`);
    }
    if (body.intro && body.credits && body.intro.end > body.credits.start) throw new HttpError(400, 'The intro must end before the credits start.');
    if (body.credits && body.postCredits && body.postCredits.start < body.credits.end) throw new HttpError(400, 'The post-credits scene must start after the credits.');
    saveManualSegments(db, id, file ? { id: file.id, size: file.size } : null, body);
    const parts = [body.intro ? 'intro' : null, body.credits ? 'credits' : null, body.postCredits ? 'post-credits' : null].filter(Boolean);
    ctx.audit.record('segments.edited', { actor: request.user, ip: request.ip, target: `episode ${id} (S${ep.seasonNumber}E${ep.episodeNumber})`, detail: parts.length ? parts.join(', ') : 'none' });
    return segmentView(db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, id)).get());
  });

  /** Removes a correction (or result): the episode is analysed automatically again. */
  app.delete<{ Params: { id: string } }>('/api/admin/segments/episodes/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const ep = db.select({ id: episodes.id, showId: episodes.showId, seasonNumber: episodes.seasonNumber }).from(episodes).where(eq(episodes.id, id)).get();
    if (!ep) throw new HttpError(404, 'Episode not found.');
    const removed = clearSegments(db, id);
    if (removed) {
      ctx.audit.record('segments.reset', { actor: request.user, ip: request.ip, target: `episode ${id}` });
      ctx.segments.reanalyze({ episodeId: id });
    }
    return { ok: true, removed };
  });

  app.post('/api/admin/segments/analyze', { preHandler: requireAdmin }, async (request) => {
    const body = analyzeBody.parse(request.body);
    if (!ctx.settings.get().segmentDetection) throw new HttpError(409, 'Intro and credits detection is turned off in the server settings.');
    if (body.scope === 'episode' && !db.select({ n: count() }).from(episodes).where(eq(episodes.id, body.episodeId)).get()?.n) throw new HttpError(404, 'Episode not found.');
    if ((body.scope === 'show' || body.scope === 'season') && !db.select({ id: shows.id }).from(shows).where(eq(shows.id, body.showId)).get()) throw new HttpError(404, 'Show not found.');
    const queued = ctx.segments.reanalyze(
      body.scope === 'all' ? 'all' : body.scope === 'episode' ? { episodeId: body.episodeId } : body.scope === 'season' ? { showId: body.showId, seasonNumber: body.seasonNumber } : { showId: body.showId },
    );
    const target = body.scope === 'all' ? 'all shows' : body.scope === 'episode' ? `episode ${body.episodeId}` : body.scope === 'season' ? `show ${body.showId} season ${body.seasonNumber}` : `show ${body.showId}`;
    ctx.audit.record('segments.analyze', { actor: request.user, ip: request.ip, target, detail: `${queued} episode(s) queued` });
    return { queued };
  });
}

