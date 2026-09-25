import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireUser } from '../app.js';
import { libraries, mediaFiles, subtitles } from '../db/schema.js';
import { resolveMediaPath } from '../services/paths.js';
import { readSubtitleAsVtt, shiftVtt } from '../services/subtitles.js';
import type { RemuxEngine } from '../playback/remux.js';
import { isValidImageRequest } from '../services/images.js';
import { languageName } from '../services/parser.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { fileInfo } from './library.js';

const capsBody = z
  .object({
    containers: z.array(z.string().max(20)).max(30).optional(),
    videoCodecs: z.array(z.string().max(20)).max(30).optional(),
    audioCodecs: z.array(z.string().max(20)).max(30).optional(),
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
  function loadFile(idParam: string) {
    const id = parseId(idParam);
    const row = db
      .select({ f: mediaFiles, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(eq(mediaFiles.id, id))
      .get();
    if (!row) throw notFound('Media file');
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
      const { file, abs } = loadFile(request.params.id);
      const engine = ctx.playback.get('direct')!;
      return engine.serve(request, reply, file, abs);
    },
  });

  app.post<{ Params: { id: string } }>('/api/media/:id/playback', { preHandler: requireUser }, async (request) => {
    const { file } = loadFile(request.params.id);
    const { audioIndex, audioChannels, boostVoices, levelVolume, ...caps } = capsBody.parse(request.body ?? {});
    if (audioIndex !== undefined && !(file.audioTracks ?? []).some((t) => t.index === audioIndex)) throw new HttpError(400, 'Unknown audio track.');
    const decision = ctx.playback.decide(file, caps, { audioIndex, audioChannels, boostVoices, levelVolume });
    if (!decision) throw new HttpError(415, 'This file cannot be played.');
    const external = db.select().from(subtitles).where(eq(subtitles.mediaFileId, file.id)).all();
    return { decision, file: fileInfo(file, external), subtitles: subtitleList(file) };
  });

  // Live remux: video copied, audio converted when needed. Seeking = request again with ?start=.
  app.get<{ Params: { id: string } }>('/api/media/:id/remux', { preHandler: requireUser }, async (request, reply) => {
    const { file, abs } = loadFile(request.params.id);
    return ctx.playback.get('remux')!.serve(request, reply, file, abs);
  });

  /** Keyframe at or before ?t=, so a restarted remux stream (and its subtitles) line up exactly. */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/media/:id/keyframe', { preHandler: requireUser }, async (request) => {
    const { file, abs } = loadFile(request.params.id);
    const t = Number(request.query.t ?? 0);
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, 'Invalid time.');
    const target = file.durationSec ? Math.min(t, Math.max(0, file.durationSec - 1)) : t;
    const engine = ctx.playback.get('remux') as RemuxEngine;
    return { start: await engine.keyframeBefore(abs, target) };
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/subtitles', { preHandler: requireUser }, async (request) => {
    const { file } = loadFile(request.params.id);
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
    if (!row) throw notFound('Subtitle');
    const abs = resolveMediaPath(row.root, row.s.path);
    if (!abs || !fs.existsSync(abs)) throw notFound('Subtitle');
    const vtt = shiftVtt(await readSubtitleAsVtt(abs, row.s.format), offsetParam(request.query));
    return reply.type('text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(vtt);
  });

  app.get<{ Params: { id: string; index: string } }>('/api/media/:id/subtitles/:index.vtt', { preHandler: requireUser }, async (request, reply) => {
    const { file, abs } = loadFile(request.params.id);
    const index = Number(request.params.index);
    const track = (file.subtitleTracks ?? []).find((t) => t.index === index);
    if (!Number.isInteger(index) || !track) throw notFound('Subtitle track');
    if (!track.textBased) throw new HttpError(415, 'Image-based subtitles (PGS/VobSub) need transcoding, which arrives in a future version.');
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
