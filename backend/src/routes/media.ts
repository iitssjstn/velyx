import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { describeUserAgent, type SessionUser } from '../auth/sessions.js';
import { requireUser } from '../app.js';
import { libraries, mediaFiles, onlineSubtitles, subtitles } from '../db/schema.js';
import { onlineSubtitleOption } from './online-subtitles.js';
import { resolveMediaPath } from '../services/paths.js';
import { readSubtitleAsVtt, shiftVtt } from '../services/subtitles.js';
import { parseRemuxQuery, remuxQueryKey, type RemuxEngine, type RemuxQuery, type VideoEncode } from '../playback/remux.js';
import { playlist as hlsPlaylist, type HlsSource } from '../playback/hls.js';
import { isValidImageRequest } from '../services/images.js';
import { languageName } from '../services/parser.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { fileInfo } from './library.js';
import { canSee } from '../services/access.js';
import type { PlaybackDecision } from '../playback/engine.js';
import { analyzePlayback } from '../playback/compatibility.js';
import { clientProfile, deviceSupport, effectiveCapabilities, profileName } from '../playback/client-profile.js';
import { requestLanguage } from '../i18n/index.js';
import { isHomeRequest } from '../services/remote-access.js';
import { CAST_TOKEN_MS, CHROMECAST_CAPS, signCastToken } from '../services/cast.js';
import { createLogger } from '../logger.js';
import type { ReadyOptimization } from '../services/optimization.js';

const log = createLogger('playback');

export const capsBody = z
  .object({
    containers: z.array(z.string().max(20)).max(30).optional(),
    videoCodecs: z.array(z.string().max(20)).max(30).optional(),
    audioCodecs: z.array(z.string().max(20)).max(30).optional(),
    tenBitCodecs: z.array(z.string().max(20)).max(30).optional(),
    hdr: z.boolean().optional(),
    audioTrackSwitching: z.boolean().optional(),
    imageSubtitles: z.boolean().optional(),
    audioIndex: z.number().int().min(0).max(1000).optional(),
    audioChannels: z.enum(['stereo', 'surround']).optional(),
    boostVoices: z.boolean().optional(),
    levelVolume: z.boolean().optional(),
    optimizationId: z.number().int().positive().optional(),
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

function needsCompatibilityCopy(decision: PlaybackDecision | null): boolean {
  return !decision || decision.engine === 'transcode' || decision.compatible === false || (decision.compatible === 'unknown' && decision.reasons.length > 0);
}

function withOptimization(decision: PlaybackDecision, optimization: ReadyOptimization): PlaybackDecision {
  const add = (url: string) => `${url}${url.includes('?') ? '&' : '?'}optimized=${optimization.id}`;
  return { ...decision, streamUrl: add(decision.streamUrl), ...(decision.hlsUrl ? { hlsUrl: add(decision.hlsUrl) } : {}), optimized: { id: optimization.id, profile: optimization.profile } };
}

function variantAudioIndex(source: typeof mediaFiles.$inferSelect, variant: typeof mediaFiles.$inferSelect, sourceIndex: number): number | null {
  const position = (source.audioTracks ?? []).findIndex((track) => track.index === sourceIndex);
  return position < 0 ? null : (variant.audioTracks ?? [])[position]?.index ?? null;
}

/** How a viewer's device shows in the activity overview: "Vidalune app on Pixel 8" or "Chrome on Windows". */
function deviceLabel(request: FastifyRequest): string {
  return request.appDevice ? `Vidalune app on ${request.appDevice}` : describeUserAgent(request.headers['user-agent']);
}

export async function mediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;

  /** Looks up a media file and verifies it still lives inside its library folder. */
  function loadFile(idParam: string, user: SessionUser, optimizationId?: number, allowMissingSource = false) {
    const id = parseId(idParam);
    const row = db
      .select({ f: mediaFiles, root: libraries.path })
      .from(mediaFiles)
      .innerJoin(libraries, eq(libraries.id, mediaFiles.libraryId))
      .where(eq(mediaFiles.id, id))
      .get();
    // Files in libraries the user may not see answer exactly like missing ones.
    if (!row || !canSee(ctx.access.scope(user), row.f.libraryId)) throw notFound('Media file');
    const sourcePath = resolveMediaPath(row.root, row.f.path);
    if (optimizationId !== undefined) {
      const optimization = ctx.optimizations.resolve(row.f.id, optimizationId, row.f.size, row.f.mtimeMs);
      const outputStat = fs.statSync(optimization.outputPath);
      const file = {
        ...row.f,
        size: outputStat.size,
        mtimeMs: Math.floor(outputStat.mtimeMs),
        container: optimization.probe.container ?? 'mp4',
        durationSec: optimization.probe.durationSec ?? row.f.durationSec,
        bitrate: optimization.probe.bitrate,
        videoCodec: optimization.probe.videoCodec,
        videoProfile: optimization.probe.videoProfile,
        videoBitDepth: optimization.probe.videoBitDepth,
        videoRange: optimization.probe.videoRange,
        width: optimization.probe.width,
        height: optimization.probe.height,
        fps: optimization.probe.fps,
        audioCodec: optimization.probe.audioCodec,
        audioChannels: optimization.probe.audioChannels,
        audioTracks: optimization.probe.audioTracks,
        subtitleTracks: row.f.subtitleTracks,
        probeError: null,
      };
      return { file, abs: optimization.outputPath, sourceFile: row.f, optimization };
    }
    if (!sourcePath && !allowMissingSource) throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    return { file: row.f, abs: sourcePath ?? '', sourceFile: row.f, optimization: null as ReadyOptimization | null };
  }

  function optimizationId(query: unknown): number | undefined {
    const value = (query as { optimized?: unknown } | undefined)?.optimized;
    if (value === undefined) return undefined;
    const result = z.coerce.number().int().positive().safeParse(value);
    if (!result.success) throw new HttpError(400, 'Invalid optimization id.');
    return result.data;
  }

  function subtitleList(file: typeof mediaFiles.$inferSelect, user: SessionUser) {
    const external = db.select().from(subtitles).where(eq(subtitles.mediaFileId, file.id)).all();
    const online = db.select().from(onlineSubtitles).where(eq(onlineSubtitles.mediaFileId, file.id)).all();
    return [
      ...external.map((s) => ({
        key: `ext-${s.id}`,
        kind: 'external' as const,
        label: s.label,
        language: s.language,
        languageName: s.language ? languageName(s.language) : null,
        // What sets this file apart from other subtitles in the same language.
        title: /\(SDH\)/i.test(s.label) ? 'SDH' : null,
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
          languageName: t.language ? languageName(t.language) : null,
          title: t.title,
          forced: t.isForced,
          isDefault: t.isDefault,
          url: `/api/media/${file.id}/subtitles/${t.index}.vtt`,
        })),
      // Fetched from OpenSubtitles by someone before.
      ...online.map((row) => onlineSubtitleOption(row, user)),
    ];
  }

  /**
   * Playing at home is free; away from home it needs remote access on the Vidalune account that
   * owns this server (like the relay). Browsing the library works everywhere.
   */
  const remoteGate = async (request: FastifyRequest) => {
    if (isHomeRequest(request, ctx.settings.get().homeNetworks)) return;
    const access = await ctx.cloud.remoteAccess(request.user?.id);
    if (access === 'allowed') return;
    throw new HttpError(
      402,
      access === 'not_linked'
        ? 'Playing away from home needs Vidalune remote access. The administrator links this server to a Vidalune account with remote access (Admin → Vidalune account).'
        : 'Playing away from home needs Vidalune remote access. The owner of this server does not have it; you can take it for yourself on vidalune.com with your Vidalune account (Account → Profile). At home everything keeps working.',
    );
  };

  // GET and HEAD share one handler; an explicit HEAD route keeps our Content-Length intact
  // (Fastify's auto-generated HEAD route would reset it to 0).
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/media/:id/stream',
    preHandler: [requireUser, remoteGate],
    handler: async (request, reply) => {
      const { file, abs } = loadFile(request.params.id, request.user!, optimizationId(request.query));
      if (request.method === 'GET') ctx.streams.touch(request.user!, file.id, 'direct', deviceLabel(request));
      const engine = ctx.playback.get('direct')!;
      return engine.serve(request, reply, file, abs);
    },
  });

  /**
   * Files scanned before 0.4.0 have no bit depth / HDR information. Look it up once, the first time
   * the file is played (one FFprobe run through the shared queue), so the decision can use it.
   * Detail pages ask for the same decision: a file that still gives no answer is not probed again.
   */
  const detailsTried = new Set<number>();
  async function ensureVideoDetails(file: typeof mediaFiles.$inferSelect, abs: string) {
    if (file.videoBitDepth !== null || file.probeError || !file.videoCodec || detailsTried.has(file.id)) return file;
    detailsTried.add(file.id);
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

  /** Identifies a file's keyframes: a changed file (size, time) is read again. */
  const hlsLayoutKey = (file: typeof mediaFiles.$inferSelect) => `${file.id}:${file.size}:${file.mtimeMs}`;

  app.post<{ Params: { id: string } }>('/api/media/:id/playback', { preHandler: [requireUser, remoteGate] }, async (request) => {
    const source = loadFile(request.params.id, request.user!, undefined, true);
    const { audioIndex, audioChannels, boostVoices, levelVolume, optimizationId: requestedOptimizationId, ...reportedCaps } = capsBody.parse(request.body ?? {});
    let loaded = requestedOptimizationId === undefined ? source : loadFile(request.params.id, request.user!, requestedOptimizationId);
    let file = loaded.abs ? await ensureVideoDetails(loaded.file, loaded.abs) : loaded.file;
    if (audioIndex !== undefined && !(file.audioTracks ?? []).some((t) => t.index === audioIndex)) throw new HttpError(400, 'Unknown audio track.');
    // Clients that do not report their formats are judged by what their kind of browser usually plays.
    const ua = request.headers['user-agent'];
    const { caps, confidence } = effectiveCapabilities(reportedCaps, clientProfile(ua));
    const lang = requestLanguage(request);
    const options = { audioIndex, audioChannels, boostVoices, levelVolume, lang };
    let decision = ctx.playback.decide(file, caps, options);
    if (!loaded.optimization && needsCompatibilityCopy(decision)) {
      for (const ready of ctx.optimizations.findReadyVariants(file.id, file.size, file.mtimeMs)) {
        const candidate = loadFile(request.params.id, request.user!, ready.id);
        const candidateAudioIndex = audioIndex === undefined ? undefined : variantAudioIndex(source.sourceFile, candidate.file, audioIndex);
        if (audioIndex !== undefined && candidateAudioIndex === null) continue;
        const candidateOptions = { ...options, ...(typeof candidateAudioIndex === 'number' ? { audioIndex: candidateAudioIndex } : {}) };
        const candidateDecision = ctx.playback.decide(candidate.file, caps, candidateOptions);
        if (candidateDecision && candidateDecision.compatible !== false) {
          loaded = candidate;
          file = candidate.file;
          decision = candidateDecision;
          break;
        }
      }
    }
    if (!loaded.optimization && !loaded.abs) throw new HttpError(404, 'Media file is no longer available. Try rescanning the library.');
    if (!decision) throw new HttpError(415, 'This file cannot be played.');
    if (loaded.optimization) decision = withOptimization(decision, loaded.optimization);
    const sourceFile = loaded.sourceFile;
    const external = db.select().from(subtitles).where(eq(subtitles.mediaFileId, sourceFile.id)).all();
    const analysis = analyzePlayback(file, caps, decision, ua, confidence, lang, request.appDevice);
    // Pieces (HLS) only for converted video, which is cut on a fixed grid. Copied video would need
    // the file's keyframes first, and listing them reads the whole file: on a NAS that takes minutes
    // and starves the stream being watched. Copied video keeps the live stream.
    const hlsUrl = decision.hlsUrl?.includes('vt=1') ? decision.hlsUrl : undefined;
    const mediaBases = [ctx.settings.serverUrl()];
    const baseUrls = [...new Set(mediaBases.flatMap((candidate) => {
      if (!candidate) return [];
      try {
        const url = new URL(candidate);
        return url.protocol === 'http:' || url.protocol === 'https:' ? [url.origin] : [];
      } catch {
        return [];
      }
    }))];
    const directPlayback = !request.appDevice && baseUrls.length
      ? { baseUrls, token: signCastToken(ctx.config.sessionSecret, { userId: request.user!.id, fileId: file.id, expiresAt: Date.now() + CAST_TOKEN_MS, artwork: false }) }
      : undefined;
    return { decision: { ...decision, hlsUrl, mode: analysis.mode }, analysis, file: fileInfo(file, external, sourceFile), subtitles: subtitleList(sourceFile, request.user!), onlineSubtitles: ctx.openSubtitles.configured, ...(directPlayback ? { directPlayback } : {}) };
  });

  /**
   * Casting: what a Chromecast plays of this file (as it is, repackaged, or converted when the
   * administrator turned video conversion on), and a
   * short-lived token that lets the Chromecast fetch just this file's stream, subtitles and artwork.
   * The sender (the app or the browser) builds the addresses with the token and its own server
   * address; the Chromecast itself is checked like any viewer (home network or remote access).
   */
  app.post('/api/cast/session', { preHandler: requireUser }, async (request) => {
    const body = z.object({ fileId: z.number().int().positive(), audioIndex: z.number().int().min(0).max(1000).optional(), optimizationId: z.number().int().positive().optional() }).parse(request.body);
    const source = loadFile(String(body.fileId), request.user!);
    let loaded = body.optimizationId === undefined ? source : loadFile(String(body.fileId), request.user!, body.optimizationId);
    let file = await ensureVideoDetails(loaded.file, loaded.abs);
    if (body.audioIndex !== undefined && !(file.audioTracks ?? []).some((t) => t.index === body.audioIndex)) throw new HttpError(400, 'Unknown audio track.');
    const lang = requestLanguage(request);
    const options = { audioIndex: body.audioIndex, audioChannels: 'stereo' as const, lang };
    let decision = ctx.playback.decide(file, CHROMECAST_CAPS, options);
    if (!loaded.optimization && needsCompatibilityCopy(decision)) {
      for (const ready of ctx.optimizations.findReadyVariants(file.id, file.size, file.mtimeMs)) {
        const candidate = loadFile(String(body.fileId), request.user!, ready.id);
        const candidateAudioIndex = body.audioIndex === undefined ? undefined : variantAudioIndex(source.sourceFile, candidate.file, body.audioIndex);
        if (body.audioIndex !== undefined && candidateAudioIndex === null) continue;
        const candidateOptions = { ...options, ...(typeof candidateAudioIndex === 'number' ? { audioIndex: candidateAudioIndex } : {}) };
        const candidateDecision = ctx.playback.decide(candidate.file, CHROMECAST_CAPS, candidateOptions);
        if (candidateDecision && candidateDecision.compatible !== false) {
          loaded = candidate;
          file = candidate.file;
          decision = candidateDecision;
          break;
        }
      }
    }
    if (!decision || decision.compatible === false) throw new HttpError(415, 'This file cannot be played on a Chromecast without converting the video. An administrator can turn on video conversion (Admin → Server).');
    if (loaded.optimization) decision = withOptimization(decision, loaded.optimization);
    const castDecision = decision.engine === 'direct'
      ? decision
      : { ...decision, streamUrl: decision.streamUrl.replace(/\/remux(?=\?)/, '/hls/index.m3u8'), seek: 'range' as const };
    const expiresAt = Date.now() + CAST_TOKEN_MS;
    const token = signCastToken(ctx.config.sessionSecret, { userId: request.user!.id, fileId: file.id, expiresAt, artwork: true });
    return {
      token,
      expiresAt,
      // The Chromecast fetches media directly; it never uses the relay.
      serverUrl: ctx.settings.serverUrl() || null,
      decision: castDecision,
      contentType: decision.engine === 'direct' ? (file.container === 'webm' ? 'video/webm' : 'video/mp4') : 'application/vnd.apple.mpegurl',
      // Text subtitles only (a Chromecast shows WebVTT), from this file.
      subtitles: subtitleList(loaded.sourceFile, request.user!).filter((s) => s.kind === 'external' || s.kind === 'embedded'),
    };
  });

  /** The current device: its name and what it plays, from the formats the browser reports. */
  app.post('/api/playback/device', { preHandler: requireUser }, async (request) => {
    const { audioIndex: _a, audioChannels: _c, boostVoices: _b, levelVolume: _l, ...reportedCaps } = capsBody.parse(request.body ?? {});
    const profile = clientProfile(request.headers['user-agent']);
    const { confidence } = effectiveCapabilities(reportedCaps, profile);
    const lang = requestLanguage(request);
    return { device: profileName(profile, lang), family: profile.family, confidence, formats: deviceSupport(reportedCaps, profile, lang) };
  });

  /** What a remux request does with the audio, for the activity log (null = passed through). */
  function remuxAudioLabel(q: Record<string, string | undefined>): string | null {
    if (q.audio === 'none' || q.copy === '1') return null;
    return `AAC ${q.ch === '6' ? '5.1' : 'stereo'}${q.voice === '1' ? ' · voices boosted' : ''}${q.level === '1' ? ' · volume levelled' : ''}`;
  }

  // Live remux: video copied, audio converted when needed. Seeking = request again with ?start=.
  app.get<{ Params: { id: string } }>('/api/media/:id/remux', { preHandler: [requireUser, remoteGate] }, async (request, reply) => {
    const { file, abs } = loadFile(request.params.id, request.user!, optimizationId(request.query));
    // A HEAD request only asks whether the stream exists: never start FFmpeg for it.
    if (request.method === 'HEAD') return reply.code(200).header('Content-Type', 'video/mp4').header('Accept-Ranges', 'none').send();
    const q = request.query as Record<string, string | undefined>;
    ctx.streams.touch(request.user!, file.id, q.vt === '1' ? 'transcode' : 'remux', deviceLabel(request), remuxAudioLabel(q));
    return ctx.playback.get('remux')!.serve(request, reply, file, abs);
  });

  // HLS: the same stream in short pieces (the website's player). The list is made from the file's
  // keyframes (or a 4-second grid when the video is converted); pieces are made as they are asked for.
  async function hlsSource(request: FastifyRequest, file: typeof mediaFiles.$inferSelect, abs: string): Promise<HlsSource> {
    const q = request.query as RemuxQuery;
    const parsed = parseRemuxQuery(file, q);
    if ('error' in parsed) throw new HttpError(400, parsed.error);
    let encode: VideoEncode | null = null;
    const vt = q.vt === '1';
    const key = `${request.user!.id}:${file.id}:${file.size}:${file.mtimeMs}:${remuxQueryKey(parsed.plan, vt)}`;
    if (vt) {
      const t = ctx.transcoding.current();
      if (!t) throw new HttpError(403, 'Video conversion is turned off on this server.');
      const remux = ctx.playback.get('remux') as RemuxEngine;
      if (t.maxStreams !== null && ctx.hls.convertingOther(key) + remux.activeTranscodes >= t.maxStreams) {
        throw new HttpError(503, 'The server is already converting {n} videos, its limit. Try again in a moment.', { n: t.maxStreams });
      }
      encode = t.encode;
    }
    const layout = await ctx.hls.layout(hlsLayoutKey(file), abs, file.durationSec ?? 0, vt);
    return { key, input: abs, videoCodec: file.videoCodec, plan: parsed.plan, layout, encode };
  }
  const hlsLoad = (request: FastifyRequest<{ Params: { id: string } }>) => {
    const { file, abs } = loadFile(request.params.id, request.user!, optimizationId(request.query));
    if (!file.durationSec) throw new HttpError(409, 'The length of this file is not known yet. Try again after the next scan.');
    return { file, abs };
  };

  app.get<{ Params: { id: string } }>('/api/media/:id/hls/index.m3u8', { preHandler: [requireUser, remoteGate] }, async (request, reply) => {
    const { file, abs } = hlsLoad(request);
    const src = await hlsSource(request, file, abs);
    const q = request.query as RemuxQuery;
    ctx.streams.touch(request.user!, file.id, q.vt === '1' ? 'transcode' : 'remux', deviceLabel(request), remuxAudioLabel(q as Record<string, string | undefined>));
    const castToken = (request.query as RemuxQuery & { cast?: unknown }).cast;
    const optimized = optimizationId(request.query);
    const query = `${remuxQueryKey(src.plan, q.vt === '1')}${optimized ? `&optimized=${optimized}` : ''}${typeof castToken === 'string' ? `&cast=${encodeURIComponent(castToken)}` : ''}`;
    return reply.type('application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').send(hlsPlaylist(src.layout, query));
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/hls/init.mp4', { preHandler: [requireUser, remoteGate] }, async (request, reply) => {
    const { file, abs } = hlsLoad(request);
    const src = await hlsSource(request, file, abs);
    const path_ = await ctx.hls.init(src).catch((err: Error) => {
      throw new HttpError(500, 'The stream could not be started ({reason}).', { reason: err.message.slice(0, 200) });
    });
    return reply.type('video/mp4').header('Cache-Control', 'no-store').send(fs.createReadStream(path_));
  });

  app.get<{ Params: { id: string; n: string } }>('/api/media/:id/hls/seg/:n.m4s', { preHandler: [requireUser, remoteGate] }, async (request, reply) => {
    const { file, abs } = hlsLoad(request);
    const n = Number(request.params.n);
    const src = await hlsSource(request, file, abs);
    if (!Number.isInteger(n) || n < 0 || n >= src.layout.starts.length) throw new HttpError(404, 'Not found.');
    const q = request.query as RemuxQuery;
    ctx.streams.touch(request.user!, file.id, q.vt === '1' ? 'transcode' : 'remux', deviceLabel(request), remuxAudioLabel(q as Record<string, string | undefined>));
    const path_ = await ctx.hls.segment(src, n).catch((err: Error) => {
      throw new HttpError(500, 'The stream could not be started ({reason}).', { reason: err.message.slice(0, 200) });
    });
    return reply.type('video/iso.segment').header('Cache-Control', 'no-store').send(fs.createReadStream(path_));
  });

  /**
   * Where a remux stream for ?t= will really start. The player requests the stream with ?start=`seek`
   * and treats `start` as stream time 0, so the clock and subtitles line up with the picture.
   */
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/api/media/:id/keyframe', { preHandler: requireUser }, async (request) => {
    const { file, abs } = loadFile(request.params.id, request.user!, optimizationId(request.query));
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
    return subtitleList(file, request.user!);
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
    if (!track.textBased) throw new HttpError(415, 'Image-based subtitles (PGS/VobSub) cannot be shown in the browser without converting them, which Vidalune does not do. Use a text subtitle (SRT/ASS) instead.');
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
