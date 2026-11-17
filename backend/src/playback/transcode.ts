import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tr } from '../i18n/index.js';
import { createLogger } from '../logger.js';
import { planAudio, planQuery, type VideoEncode } from './remux.js';
import type { ClientCapabilities, MediaFileRow, PlaybackDecision, PlaybackEngine, PlaybackOptions } from './engine.js';

const log = createLogger('transcode');

/** How the server encodes video: on the processor, or with Intel/AMD (VAAPI) or NVIDIA (NVENC) hardware. */
export type Encoder = 'software' | 'vaapi' | 'nvenc';
export const ENCODERS: Encoder[] = ['nvenc', 'vaapi', 'software'];

export interface TranscodingSettings {
  /** Off by default: video is only converted when an administrator turns this on. */
  enabled: boolean;
  /** 'auto' picks the fastest encoder that works on this server. */
  encoder: 'auto' | Encoder;
  /** How many videos may be converted at once; null = no limit. */
  maxStreams: number | null;
}

export const DEFAULT_TRANSCODING: TranscodingSettings = { enabled: false, encoder: 'auto', maxStreams: null };

/** What this server can encode with, found by trying each encoder for a moment. */
export interface EncoderSupport {
  software: boolean;
  vaapi: string | null;
  nvenc: boolean;
  /** Encoders that run but ignore keyframes asked for at a given time, so HLS cannot cut its pieces: not used. */
  noKeyframes?: Encoder[];
  checkedAt: number;
}

/**
 * FFmpeg arguments for H.264 video (8-bit, which every browser, phone and Chromecast plays) at the
 * source's own resolution, in 2-second fragments so the stream starts quickly.
 */
export function encodeArgs(encoder: Encoder, vaapiDevice: string | null = null): VideoEncode {
  const gop = ['-g', '48', '-keyint_min', '48'];
  switch (encoder) {
    case 'nvenc':
      return { input: [], output: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-forced-idr', '1', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-maxrate', '40M', '-bufsize', '80M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', ...gop] };
    case 'vaapi':
      return {
        input: ['-vaapi_device', vaapiDevice ?? '/dev/dri/renderD128'],
        output: ['-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-rc_mode', 'QVBR', '-global_quality', '21', '-b:v', '20M', '-maxrate', '40M', '-profile:v', 'high', ...gop],
      };
    default:
      return { input: [], output: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-maxrate', '40M', '-bufsize', '80M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', ...gop] };
  }
}

/** The encoder to use: the chosen one when it works here, otherwise the fastest that does. */
export function pickEncoder(choice: TranscodingSettings['encoder'], support: EncoderSupport): Encoder | null {
  const works = (e: Encoder) => (e === 'software' ? support.software : e === 'vaapi' ? support.vaapi !== null : support.nvenc);
  if (choice !== 'auto') return works(choice) ? choice : null;
  return ENCODERS.find(works) ?? null;
}

type Runner = (args: string[]) => Promise<boolean>;

/** Where a forced keyframe must start a new piece in the encoder test (seconds of a 3-second picture). */
const TEST_KEYFRAMES = [1, 2];

/**
 * Tries each encoder on a few seconds of test picture, the way HLS uses it: no keyframes of its own, only
 * the ones asked for at each piece's start, and a new piece at every one. Listed is not enough (no driver,
 * no GPU in the container), and an encoder that runs but ignores the asked keyframes would make one endless
 * piece the player waits on for ever, so that one is not used either.
 */
export async function detectEncoders(ffmpegPath: string, run: Runner = ffmpegRunner(ffmpegPath), devices: string[] = renderDevices()): Promise<EncoderSupport> {
  const noKeyframes: Encoder[] = [];
  const tryEncoder = async (encoder: Encoder, device: string | null = null): Promise<boolean> => {
    const encode = encodeArgs(encoder, device);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-encoder-'));
    try {
      const ran = await run([
        ...encode.input, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-t', '3',
        ...encode.output, '-g', String(HLS_KEYFRAME_FREE), '-force_key_frames', TEST_KEYFRAMES.join(','),
        '-f', 'hls', '-hls_time', '0.01', '-hls_segment_type', 'fmp4', '-hls_list_size', '0',
        '-hls_segment_filename', path.join(dir, 'seg%d.m4s'), path.join(dir, 'index.m3u8'),
      ]);
      if (!ran) return false;
      const pieces = fs.readdirSync(dir).filter((f) => f.endsWith('.m4s')).length;
      if (pieces > TEST_KEYFRAMES.length) return true;
      if (!noKeyframes.includes(encoder)) noKeyframes.push(encoder);
      log.warn(`${encoder}${device ? ` (${device})` : ''} runs, but ignores the keyframes Vidalune asks for: not used for converting video`);
      return false;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const software = await tryEncoder('software');
  const nvenc = await tryEncoder('nvenc');
  let vaapi: string | null = null;
  for (const device of devices) {
    if (await tryEncoder('vaapi', device)) {
      vaapi = device;
      break;
    }
  }
  log.info(`Video encoders: ${[software && 'software', vaapi && `VAAPI (${vaapi})`, nvenc && 'NVENC'].filter(Boolean).join(', ') || 'none'}`);
  return { software, vaapi, nvenc, noKeyframes: noKeyframes.filter((e) => e !== 'vaapi' || !vaapi), checkedAt: Date.now() };
}

function ffmpegRunner(ffmpegPath: string): Runner {
  return (args) => new Promise((resolve) => execFile(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { timeout: 20000 }, (err) => resolve(!err)));
}

/** The graphics devices a VAAPI encoder can use (none in a container without /dev/dri). */
function renderDevices(): string[] {
  try {
    return fs
      .readdirSync('/dev/dri')
      .filter((f) => f.startsWith('renderD'))
      .sort()
      .map((f) => `/dev/dri/${f}`);
  } catch {
    return [];
  }
}

/** No keyframes of the encoder's own in HLS (see hlsArgs); the test above uses the same. */
export const HLS_KEYFRAME_FREE = 100_000;

const ENCODER_NAMES: Record<Encoder, string> = { software: 'processor', vaapi: 'Intel/AMD graphics', nvenc: 'NVIDIA graphics' };

/**
 * Converts the video to H.264 when the device cannot play it as it is, and only when an
 * administrator turned it on. Registered after direct play and remux, so it is the last resort: a
 * file that plays (or plays after repackaging) is never converted. Streams through the remux route
 * with &vt=1, so seeking works exactly like a remux.
 */
export class TranscodeEngine implements PlaybackEngine {
  readonly id = 'transcode';

  constructor(private readonly current: () => { encoder: Encoder } | null) {}

  decide(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): PlaybackDecision | null {
    const t = this.current();
    if (!t || !file.videoCodec) return null;
    // H.264 is the one format every browser, phone and Chromecast decodes.
    if (caps.videoCodecs?.length && !caps.videoCodecs.includes('h264')) return null;
    const plan = planAudio(file, caps, options);
    const lang = options.lang ?? 'en';
    return {
      engine: this.id,
      streamUrl: `/api/media/${file.id}/remux${planQuery(plan)}&vt=1`,
      hlsUrl: `/api/media/${file.id}/hls/index.m3u8${planQuery(plan)}&vt=1`,
      compatible: true,
      reasons: [],
      seek: 'restart',
      audioIndex: plan.audioIndex,
      note: tr(lang, 'The video is converted to H.264 on the server ({encoder}).', { encoder: tr(lang, ENCODER_NAMES[t.encoder]) }),
      durationSec: file.durationSec,
    };
  }

  serve(): never {
    throw new Error('Transcoded streams are served by the remux engine.');
  }
}

/** Transcoding as configured: the administrator's settings plus what this server's hardware can do. */
export class TranscodingService {
  support: EncoderSupport | null = null;
  private detecting: Promise<EncoderSupport> | null = null;

  constructor(
    private readonly ffmpegPath: string,
    private readonly settings: () => TranscodingSettings,
    private readonly detector: (ffmpegPath: string) => Promise<EncoderSupport> = (p) => detectEncoders(p),
  ) {
    if (settings().enabled) void this.detect();
  }

  /** Tries the encoders (again). */
  detect(): Promise<EncoderSupport> {
    this.detecting ??= this.detector(this.ffmpegPath)
      .catch((err: unknown) => {
        log.warn(`Could not check the video encoders: ${String(err)}`);
        return { software: false, vaapi: null, nvenc: false, checkedAt: Date.now() };
      })
      .then((s) => {
        this.support = s;
        this.detecting = null;
        return s;
      });
    return this.detecting;
  }

  /** Transcoding now: on, with a working encoder (null: off, or no encoder works here). */
  current(): { encoder: Encoder; encode: VideoEncode; maxStreams: number | null } | null {
    const t = this.settings();
    if (!t.enabled) return null;
    if (!this.support) {
      void this.detect();
      return null;
    }
    const encoder = pickEncoder(t.encoder, this.support);
    if (!encoder) return null;
    return { encoder, encode: encodeArgs(encoder, this.support.vaapi), maxStreams: t.maxStreams };
  }
}
