import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '../logger.js';
import { COPYABLE_VIDEO, videoSupport } from './compatibility.js';
import { requestLanguage, tr } from '../i18n/index.js';
import { defaultAudioIndex, wantsAudioProcessing, type ClientCapabilities, type MediaFileRow, type PlaybackDecision, type PlaybackEngine, type PlaybackOptions } from './engine.js';

const log = createLogger('remux');

/** Audio codecs that can be copied into MP4 when the browser decodes them; everything else becomes AAC. */
const COPYABLE_AUDIO = new Set(['aac', 'mp3']);

const MAX_PROCESSES = 6;

export interface RemuxPlan {
  audioIndex: number | null;
  copyAudio: boolean;
  /** Output channels when converting (2 = stereo, 6 = 5.1). */
  channels?: number;
  /** Source channel count of the selected track (used to pick the right filters). */
  sourceChannels?: number | null;
  boostVoices?: boolean;
  levelVolume?: boolean;
}

/** Output channel count for converted audio. Surround keeps up to 5.1; 7.1 is folded down to 5.1. */
export function outputChannels(sourceChannels: number | null | undefined, mode: 'stereo' | 'surround' = 'stereo'): number {
  if (mode === 'stereo') return 2;
  return (sourceChannels ?? 2) >= 6 ? 6 : 2;
}

/**
 * FFmpeg audio filter chain for the requested processing ("Boost voices" and
 * volume levelling). Every chain first normalises the channel layout, so it works for 5.1, 5.1(side),
 * 7.1 and stereo sources alike.
 */
export function audioFilters(plan: RemuxPlan): string {
  // Fill gaps / drop overlaps in the source audio timestamps. Browsers play audio samples back to
  // back and ignore timestamp jumps, so without this every gap makes the sound run ahead of the picture.
  const filters: string[] = ['aresample=async=1'];
  const channels = plan.channels ?? 2;
  const multichannel = (plan.sourceChannels ?? 2) >= 3;
  if (plan.boostVoices) {
    if (multichannel && channels === 2) {
      // Downmix with the dialogue (center) channel emphasised.
      filters.push('aformat=channel_layouts=5.1', 'pan=stereo|FL=0.9*FC+0.55*FL+0.4*BL|FR=0.9*FC+0.55*FR+0.4*BR');
    } else if (multichannel && channels === 6) {
      filters.push('aformat=channel_layouts=5.1', 'pan=5.1|FL=0.7*FL|FR=0.7*FR|FC=FC|LFE=0.7*LFE|BL=0.7*BL|BR=0.7*BR');
    } else {
      // Stereo source: lift the speech band, tame rumble.
      filters.push('equalizer=f=2500:t=q:w=1.2:g=4', 'equalizer=f=120:t=q:w=1:g=-3');
    }
  }
  if (plan.levelVolume) filters.push('dynaudnorm=f=250:g=15:m=8');
  return filters.join(',');
}

/**
 * Plans a remux: which audio track to deliver and whether it must be converted.
 * Returns null when the video itself is not playable (that needs a full video transcode).
 */
export function planRemux(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): RemuxPlan | null {
  if (!file.videoCodec || !COPYABLE_VIDEO.has(file.videoCodec)) return null;
  const reported = Boolean(caps.videoCodecs?.length);
  const video = videoSupport(file, caps);
  if (video.ok === false) return null;
  if (!reported && file.videoCodec !== 'h264') return null;
  const tracks = file.audioTracks ?? [];
  const wanted = options.audioIndex !== undefined ? tracks.find((t) => t.index === options.audioIndex) : undefined;
  const audioIndex = wanted?.index ?? defaultAudioIndex(file);
  const track = tracks.find((t) => t.index === audioIndex);
  const codec = track?.codec ?? null;
  const processing = wantsAudioProcessing(options);
  const copyAudio = !processing && Boolean(codec && COPYABLE_AUDIO.has(codec) && (caps.audioCodecs ?? ['aac', 'mp3']).includes(codec));
  return {
    audioIndex,
    copyAudio,
    channels: outputChannels(track?.channels, options.audioChannels),
    sourceChannels: track?.channels ?? null,
    boostVoices: Boolean(options.boostVoices),
    levelVolume: Boolean(options.levelVolume),
  };
}

/** Builds the FFmpeg arguments: copy video, copy or convert one audio track, write fragmented MP4 to stdout. */
export function remuxArgs(input: string, videoCodec: string | null, plan: RemuxPlan, start: number): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  // Seek to the keyframe at or before `start`. -noaccurate_seek makes the (converted) audio start at
  // that same keyframe instead of exactly at `start`, so both streams begin together; the player learns
  // the real starting point from seekLanding().
  if (start > 0) args.push('-noaccurate_seek', '-ss', start.toFixed(3));
  args.push('-fflags', '+genpts', '-i', input, '-map', '0:v:0');
  if (plan.audioIndex !== null) args.push('-map', `0:${plan.audioIndex}`);
  args.push('-c:v', 'copy');
  if (videoCodec === 'hevc') args.push('-tag:v', 'hvc1');
  if (plan.audioIndex !== null) {
    if (plan.copyAudio) args.push('-c:a', 'copy');
    else {
      const channels = plan.channels ?? 2;
      args.push('-af', audioFilters(plan));
      args.push('-c:a', 'aac', '-ac', String(channels), '-b:a', channels > 2 ? '384k' : '192k');
    }
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

/** Reads the first packet's presentation time (seconds) from FFmpeg framemd5 output. */
export function parseFramemd5Start(output: string): number | null {
  let tb: number | null = null;
  for (const line of output.split('\n')) {
    const m = /^#tb 0:\s*(\d+)\/(\d+)/.exec(line);
    if (m) tb = Number(m[1]) / Number(m[2]);
    else if (tb !== null && line && !line.startsWith('#')) {
      const pts = Number(line.split(',')[2]);
      return Number.isFinite(pts) ? Math.round(pts * tb * 1000) / 1000 : null;
    }
  }
  return null;
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

  constructor(private readonly ffmpegPath: string) {}

  decide(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): PlaybackDecision | null {
    const plan = planRemux(file, caps, options);
    if (!plan) return null;
    const track = (file.audioTracks ?? []).find((t) => t.index === plan.audioIndex);
    const lang = options.lang ?? 'en';
    const extras = [plan.boostVoices ? tr(lang, 'voices boosted') : null, plan.levelVolume ? tr(lang, 'volume levelled') : null].filter(Boolean).join(', ');
    const target = `AAC ${plan.channels === 6 ? '5.1' : tr(lang, 'stereo')}`;
    const codec = track?.codec ? track.codec.toUpperCase() : tr(lang, 'Audio');
    const note =
      plan.audioIndex === null || plan.copyAudio
        ? null
        : extras
          ? tr(lang, '{codec} audio is converted to {target} ({extras}).', { codec, target, extras })
          : tr(lang, '{codec} audio is converted to {target}.', { codec, target });
    const query =
      plan.audioIndex === null
        ? '?audio=none'
        : `?audio=${plan.audioIndex}${plan.copyAudio ? '&copy=1' : `&ch=${plan.channels ?? 2}${plan.boostVoices ? '&voice=1' : ''}${plan.levelVolume ? '&level=1' : ''}`}`;
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

  /**
   * Where a stream requested with ?start=`target` really begins: the video keyframe FFmpeg lands on.
   * Found by running FFmpeg with the very same seek and reading the first packet's timestamp, so it
   * always matches the stream (demuxers differ in which keyframe they pick). Reading one packet is fast.
   */
  seekLanding(absolutePath: string, target: number): Promise<number> {
    if (target <= 0) return Promise.resolve(0);
    const args = ['-v', 'error', '-nostdin', '-noaccurate_seek', '-ss', target.toFixed(3), '-copyts', '-i', absolutePath, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-f', 'framemd5', '-'];
    return new Promise((resolve) => {
      execFile(this.ffmpegPath, args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        const landing = err ? null : parseFramemd5Start(String(stdout));
        if (landing === null) {
          log.warn(`Could not determine the seek position for ${absolutePath}${err ? `: ${err.message}` : ''}`);
          resolve(target);
          return;
        }
        resolve(Math.max(0, Math.min(landing, target)));
      });
    });
  }

  async serve(request: FastifyRequest, reply: FastifyReply, file: MediaFileRow, absolutePath: string): Promise<FastifyReply> {
    const q = request.query as { audio?: string; start?: string; copy?: string; ch?: string; voice?: string; level?: string };
    const tracks = file.audioTracks ?? [];
    let audioIndex: number | null;
    if (q.audio === 'none' || tracks.length === 0) audioIndex = null;
    else if (q.audio !== undefined) {
      const n = Number(q.audio);
      if (!Number.isInteger(n) || !tracks.some((t) => t.index === n)) return reply.code(400).send({ error: tr(requestLanguage(request), 'Unknown audio track.') });
      audioIndex = n;
    } else audioIndex = defaultAudioIndex(file);
    const start = q.start !== undefined ? Number(q.start) : 0;
    if (!Number.isFinite(start) || start < 0 || (file.durationSec && start > file.durationSec)) return reply.code(400).send({ error: tr(requestLanguage(request), 'Invalid start position.') });

    // copy=1 comes from our own decision (the browser decodes this codec); it is only honoured for MP4-safe codecs.
    const track = tracks.find((t) => t.index === audioIndex);
    const codec = track?.codec ?? null;
    if (q.ch !== undefined && q.ch !== '2' && q.ch !== '6') return reply.code(400).send({ error: tr(requestLanguage(request), 'Invalid channel count.') });
    const plan: RemuxPlan = {
      audioIndex,
      copyAudio: q.copy === '1' && Boolean(codec && COPYABLE_AUDIO.has(codec)),
      // Never upmix: 5.1 only when the source has at least six channels.
      channels: q.ch === '6' ? outputChannels(track?.channels, 'surround') : 2,
      sourceChannels: track?.channels ?? null,
      boostVoices: q.voice === '1',
      levelVolume: q.level === '1',
    };

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
