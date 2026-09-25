import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '../logger.js';
import { defaultAudioIndex, type ClientCapabilities, type MediaFileRow, type PlaybackDecision, type PlaybackEngine, type PlaybackOptions } from './engine.js';

const log = createLogger('remux');

/** Video codecs that can be copied (not re-encoded) into fragmented MP4. */
const COPYABLE_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9']);
/** Audio codecs that can be copied into MP4 when the browser decodes them; everything else becomes AAC. */
const COPYABLE_AUDIO = new Set(['aac', 'mp3']);

const MAX_PROCESSES = 6;

export interface RemuxPlan {
  audioIndex: number | null;
  copyAudio: boolean;
}

/**
 * Plans a remux: which audio track to deliver and whether it must be converted.
 * Returns null when the video itself is not playable (that needs a full video transcode).
 */
export function planRemux(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): RemuxPlan | null {
  if (!file.videoCodec || !COPYABLE_VIDEO.has(file.videoCodec)) return null;
  const reported = Boolean(caps.videoCodecs?.length);
  if (reported && !caps.videoCodecs!.includes(file.videoCodec)) return null;
  if (!reported && file.videoCodec !== 'h264') return null;
  const tracks = file.audioTracks ?? [];
  const wanted = options.audioIndex !== undefined ? tracks.find((t) => t.index === options.audioIndex) : undefined;
  const audioIndex = wanted?.index ?? defaultAudioIndex(file);
  const codec = tracks.find((t) => t.index === audioIndex)?.codec ?? null;
  const copyAudio = Boolean(codec && COPYABLE_AUDIO.has(codec) && (caps.audioCodecs ?? ['aac', 'mp3']).includes(codec));
  return { audioIndex, copyAudio };
}

/** Builds the FFmpeg arguments: copy video, copy or convert one audio track, write fragmented MP4 to stdout. */
export function remuxArgs(input: string, videoCodec: string | null, plan: RemuxPlan, start: number): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  // `start` is a keyframe time. With stream copy FFmpeg begins at the keyframe at or before -ss, and
  // some demuxers (Matroska) land one keyframe early when -ss hits it exactly — so aim just past it.
  if (start > 0) args.push('-ss', (start + 0.1).toFixed(3));
  args.push('-fflags', '+genpts', '-i', input, '-map', '0:v:0');
  if (plan.audioIndex !== null) args.push('-map', `0:${plan.audioIndex}`);
  args.push('-c:v', 'copy');
  if (videoCodec === 'hevc') args.push('-tag:v', 'hvc1');
  if (plan.audioIndex !== null) {
    if (plan.copyAudio) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
  }
  args.push(
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-max_muxing_queue_size',
    '2048',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  );
  return args;
}

/** Picks the last value that is <= target (+ a small tolerance), used to find the keyframe before a seek point. */
export function pickKeyframe(times: number[], target: number): number {
  let best = 0;
  for (const t of times) if (t <= target + 0.05 && t > best) best = t;
  return best;
}

/**
 * Plays files whose video the browser can decode but whose audio (EAC3, AC3, DTS, TrueHD, …) or
 * container it cannot, and lets any browser switch audio tracks. The video stream is copied as-is
 * (almost no CPU); only the selected audio track is converted to AAC stereo when needed. Output is
 * fragmented MP4 streamed live, so seeking restarts FFmpeg at the nearest keyframe.
 */
export class RemuxEngine implements PlaybackEngine {
  readonly id = 'remux';
  private readonly processes = new Set<ChildProcess>();

  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string,
  ) {}

  decide(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): PlaybackDecision | null {
    const plan = planRemux(file, caps, options);
    if (!plan) return null;
    const track = (file.audioTracks ?? []).find((t) => t.index === plan.audioIndex);
    const note =
      plan.audioIndex === null
        ? null
        : plan.copyAudio
          ? null
          : `${(track?.codec ?? 'Audio').toUpperCase()} audio is converted to AAC stereo for this browser.`;
    const query = plan.audioIndex !== null ? `?audio=${plan.audioIndex}${plan.copyAudio ? '&copy=1' : ''}` : '?audio=none';
    return {
      engine: this.id,
      streamUrl: `/api/media/${file.id}/remux${query}`,
      compatible: true,
      reasons: [],
      seek: 'restart',
      audioIndex: plan.audioIndex,
      note,
      durationSec: file.durationSec,
    };
  }

  /** Finds the video keyframe at or before `target`, so a restarted stream lines up exactly. */
  keyframeBefore(absolutePath: string, target: number): Promise<number> {
    if (target <= 0) return Promise.resolve(0);
    const from = Math.max(0, target - 20);
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      // Packet flags need no decoding, so this is fast even on slow CPUs.
      '-show_entries',
      'packet=pts_time,flags',
      '-read_intervals',
      `${from.toFixed(3)}%${(target + 0.1).toFixed(3)}`,
      '-of',
      'csv=p=0',
      absolutePath,
    ];
    return new Promise((resolve) => {
      execFile(this.ffprobePath, args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          log.warn(`Keyframe lookup failed, seeking without alignment: ${err.message}`);
          resolve(target);
          return;
        }
        const times = String(stdout)
          .split('\n')
          .filter((l) => l.split(',')[1]?.includes('K'))
          .map((l) => Number.parseFloat(l.split(',')[0] ?? ''))
          .filter((n) => Number.isFinite(n));
        resolve(times.length ? pickKeyframe(times, target) : target);
      });
    });
  }

  async serve(request: FastifyRequest, reply: FastifyReply, file: MediaFileRow, absolutePath: string): Promise<FastifyReply> {
    const q = request.query as { audio?: string; start?: string; copy?: string };
    const tracks = file.audioTracks ?? [];
    let audioIndex: number | null;
    if (q.audio === 'none' || tracks.length === 0) audioIndex = null;
    else if (q.audio !== undefined) {
      const n = Number(q.audio);
      if (!Number.isInteger(n) || !tracks.some((t) => t.index === n)) return reply.code(400).send({ error: 'Unknown audio track.' });
      audioIndex = n;
    } else audioIndex = defaultAudioIndex(file);
    const start = q.start !== undefined ? Number(q.start) : 0;
    if (!Number.isFinite(start) || start < 0 || (file.durationSec && start > file.durationSec)) return reply.code(400).send({ error: 'Invalid start position.' });

    // copy=1 comes from our own decision (the browser decodes this codec); it is only honoured for MP4-safe codecs.
    const codec = tracks.find((t) => t.index === audioIndex)?.codec ?? null;
    const plan: RemuxPlan = { audioIndex, copyAudio: q.copy === '1' && Boolean(codec && COPYABLE_AUDIO.has(codec)) };

    // Keep resource use bounded on small servers: drop the oldest stream when the limit is reached.
    if (this.processes.size >= MAX_PROCESSES) {
      const oldest = this.processes.values().next().value;
      oldest?.kill('SIGKILL');
    }

    const child = spawn(this.ffmpegPath, remuxArgs(absolutePath, file.videoCodec, plan, start), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.add(child);
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString();
    });
    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    request.raw.on('close', stop);
    child.on('close', (code, signal) => {
      this.processes.delete(child);
      if (code && code !== 0 && signal === null) log.warn(`FFmpeg exited with code ${code} for ${absolutePath}: ${stderr.trim()}`);
    });
    child.on('error', (err) => {
      this.processes.delete(child);
      log.error(`Could not start FFmpeg (${this.ffmpegPath}): ${err.message}`);
    });

    reply.header('Content-Type', 'video/mp4');
    reply.header('Accept-Ranges', 'none');
    reply.header('Cache-Control', 'no-store');
    return reply.code(200).send(child.stdout);
  }

  /** Stops all running streams (used on shutdown). */
  stopAll(): void {
    for (const p of this.processes) p.kill('SIGKILL');
  }

  get activeStreams(): number {
    return this.processes.size;
  }
}
