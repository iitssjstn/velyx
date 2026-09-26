import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { describeUserAgent, type SessionUser } from '../auth/sessions.js';
import { requireUser } from '../app.js';
import { libraries, mediaFiles, subtitles } from '../db/schema.js';
import { resolveMediaPath } from '../services/paths.js';
import { readSubtitleAsVtt, shiftVtt } from '../services/subtitles.js';
import type { RemuxEngine } from '../playback/remux.js';
import { isValidImageRequest } from '../services/images.js';
import { languageName } from '../services/parser.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { fileInfo } from './library.js';
import { canSee } from '../services/access.js';
import { analyzePlayback } from '../playback/compatibility.js';
import { createLogger } from '../logger.js';

const log = createLogger('playback');

const capsBody = z
  .object({
    containers: z.array(z.string().max(20)).max(30).optional(),
    videoCodecs: z.array(z.string().max(20)).max(30).optional(),
    audioCodecs: z.array(z.string().max(20)).max(30).optional(),
    tenBitCodecs: z.array(z.string().max(20)).max(30).optional(),
    hdr: z.boolean().optional(),
    audioIndex: z.number().int().min(0).max(1000).optional(),
    audioChannels: z.enum(['stereo', 'surround']).optional(),
    boostVoices: z.boolean().optional(),
    levelVolume: z.boolean().optional(),
  })
  .default({});

/** ?offset= on subtitle URLs: seconds to subtract from every cue (for streams that start later). */
function offsetParam(query: unknown): number {
  const raw = (query as { offset?: string } | undefined)?.offset;
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new HttpError(400, 'Invalid subtitle offset.');
  return n;
}

export async function mediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;

  /** Looks up a media file and verifies it still lives inside its library folder. */
  function loadFile(idParam: string, user: SessionUser) {
    const id = parseId(idParam);
    const row = db
      .select({ f: mediaFiles, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(eq(mediaFiles.id, id))
      .get();
    // Files in libraries the user may not see answer exactly like missing ones.
    if (!row || !canSee(ctx.access.scope(user), row.f.libraryId)) throw notFound('Media file');
    const abs = resolveMediaPath(row.root, row.f.path);
    if (!abs) throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    return { file: row.f, abs };
  }

  function subtitleList(file: typeof mediaFiles.$inferSelect) {
    const external = db.select().from(subtitles).where(eq(subtitles.mediaFileId, file.id)).all();
    return [
      ...external.map((s) => ({
        key: `ext-${s.id}`,
        kind: 'external' as const,
        label: s.label,
        language: s.language,
        forced: s.forced,
        isDefault: false,
        url: `/api/subtitles/${s.id}.vtt`,
      })),
      ...(file.subtitleTracks ?? [])
        .filter((t) => t.textBased)
        .map((t) => ({
          key: `emb-${t.index}`,
          kind: 'embedded' as const,
          label: [t.title || languageName(t.language), t.isForced ? '(forced)' : ''].filter(Boolean).join(' '),
          language: t.language,
          forced: t.isForced,
          isDefault: t.isDefault,
          url: `/api/media/${file.id}/subtitles/${t.index}.vtt`,
        })),
    ];
  }

  // GET and HEAD share one handler; an explicit HEAD route keeps our Content-Length intact
  // (Fastify's auto-generated HEAD route would reset it to 0).
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/media/:id/stream',
    preHandler: requireUser,
    handler: async (request, reply) => {
      const { file, abs } = loadFile(request.params.id, request.user!);
      if (request.method === 'GET') ctx.streams.touch(request.user!, file.id, 'direct', describeUserAgent(request.headers['user-agent']));
      const engine = ctx.playback.get('direct')!;
      return engine.serve(request, reply, file, abs);
    },
  });

  /**
   * Files scanned before 0.4.0 have no bit depth / HDR information. Look it up once, the first time
   * the file is played (one FFprobe run through the shared queue), so the decision can use it.
   */
  async function ensureVideoDetails(file: typeof mediaFiles.$inferSelect, abs: string) {
    if (file.videoBitDepth !== null || file.probeError || !file.videoCodec) return file;
    try {
      const info = await ctx.probe.urgent(abs);
      return db
        .update(mediaFiles)
        .set({ videoBitDepth: info.videoBitDepth, videoRange: info.videoRange })
        .where(eq(mediaFiles.id, file.id))
        .returning()
        .get();
    } catch (err) {
      log.warn(`Could not analyse ${abs}`, err);
      return file;
    }
  }

  app.post<{ Params: { id: string } }>('/api/media/:id/playback', { preHandler: requireUser }, async (request) => {
    const loaded = loadFile(request.params.id, request.user!);
    const file = await ensureVideoDetails(loaded.file, loaded.abs);
    const { audioIndex, audioChannels, boostVoices, levelVolume, ...caps } = capsBody.parse(request.body ?? {});
    if (audioIndex !== undefined && !(file.audioTracks ?? []).some((t) => t.index === audioIndex)) throw new HttpError(400, 'Unknown audio track.');
    const decision = ctx.playback.decide(file, caps, { audioIndex, audioChannels, boostVoices, levelVolume });
    if (!decision) throw new HttpError(415, 'This file cannot be played.');
    const external = db.select().from(subtitles).where(eq(subtitles.mediaFileId, file.id)).all();
    const analysis = analyzePlayback(file, caps, decision, request.headers['user-agent']);
    return { decision: { ...decision, mode: analysis.mode }, analysis, file: fileInfo(file, external), subtitles: subtitleList(file) };
  });

  // Live remux: video copied, audio converted when needed. Seeking = request again with ?start=.
  app.get<{ Params: { id: string } }>('/api/media/:id/remux', { preHandler: requireUser }, async (request, reply) => {
    const { file, abs } = loadFile(request.params.id, request.user!);
    // A HEAD request only asks whether the stream exists: never start FFmpeg for it.
    if (request.method === 'HEAD') return reply.code(200).header('Content-Type', 'video/mp4').header('Accept-Ranges', 'none').send();
    ctx.streams.touch(request.user!, file.id, 'remux', describeUserAgent(request.headers['user-agent']));
    return ctx.playback.get('remux')!.serve(request, reply, file, abs);
  });

  /**
   * Where a remux stream for ?t= will really start. The player requests the stream with ?start=`seek`
   * and treats `start` as stream time 0, so the clock and subtitles line up with the picture.
   */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/media/:id/keyframe', { preHandler: requireUser }, async (request) => {
    const { file, abs } = loadFile(request.params.id, request.user!);
    const t = Number(request.query.t ?? 0);
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, 'Invalid time.');
    const target = file.durationSec ? Math.min(t, Math.max(0, file.durationSec - 1)) : t;
    const engine = ctx.playback.get('remux') as RemuxEngine;
    return { start: await engine.seekLanding(abs, target), seek: target };
  });

  /** Whether the file can still be read, so the player can tell "file gone" apart from "cannot decode". */
  app.get<{ Params: { id: string } }>('/api/media/:id/available', { preHandler: requireUser }, async (request) => {
    const { abs } = loadFile(request.params.id, request.user!);
    try {
      await fs.promises.access(abs, fs.constants.R_OK);
    } catch {
      throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    }
    return { available: true };
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/subtitles', { preHandler: requireUser }, async (request) => {
    const { file } = loadFile(request.params.id, request.user!);
    return subtitleList(file);
  });

  app.get<{ Params: { id: string } }>('/api/subtitles/:id.vtt', { preHandler: requireUser }, async (request, reply) => {
    const id = parseId(request.params.id);
    const row = db
      .select({ s: subtitles, f: mediaFiles, root: libraries.path })
      .from(subtitles)
      .innerJoin(mediaFiles, eq(mediaFiles.id, subtitles.mediaFileId))
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(eq(subtitles.id, id))
      .get();
    if (!row || !canSee(ctx.access.scope(request.user!), row.f.libraryId)) throw notFound('Subtitle');
    const abs = resolveMediaPath(row.root, row.s.path);
    if (!abs || !fs.existsSync(abs)) throw notFound('Subtitle');
    const vtt = shiftVtt(await readSubtitleAsVtt(abs, row.s.format), offsetParam(request.query));
    return reply.type('text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(vtt);
  });

  app.get<{ Params: { id: string; index: string } }>('/api/media/:id/subtitles/:index.vtt', { preHandler: requireUser }, async (request, reply) => {
    const { file, abs } = loadFile(request.params.id, request.user!);
    const index = Number(request.params.index);
    const track = (file.subtitleTracks ?? []).find((t) => t.index === index);
    if (!Number.isInteger(index) || !track) throw notFound('Subtitle track');
    if (!track.textBased) throw new HttpError(415, 'Image-based subtitles (PGS/VobSub) cannot be shown in the browser without converting them, which Velyx does not do. Use a text subtitle (SRT/ASS) instead.');
    const vtt = shiftVtt(await ctx.subtitleExtractor.extract(file.id, file.mtimeMs, abs, index), offsetParam(request.query));
    return reply.type('text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(vtt);
  });

  app.get<{ Params: { size: string; file: string } }>('/api/images/:size/:file', { preHandler: requireUser }, async (request, reply) => {
    const { size, file } = request.params;
    if (!isValidImageRequest(size, file)) throw notFound('Image');
    const local = await ctx.images.get(size, file);
    if (!local) throw notFound('Image');
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.type(type).header('Cache-Control', 'private, max-age=604800, immutable').send(fs.createReadStream(local));
  });
}
