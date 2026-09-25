import { execFile } from 'node:child_process';
import type { AudioTrackInfo, SubtitleTrackInfo } from '../db/schema.js';

export interface ProbeResult {
  container: string | null;
  durationSec: number | null;
  bitrate: number | null;
  videoCodec: string | null;
  videoProfile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
}

export type Prober = (file: string) => Promise<ProbeResult>;

export const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

interface FfStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  channel_layout?: string;
  disposition?: { default?: number; forced?: number; attached_pic?: number };
  tags?: Record<string, string>;
}

interface FfOutput {
  streams?: FfStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate || rate === '0/0') return null;
  const [a, b] = rate.split('/').map(Number);
  if (!b) return num(a);
  const fps = a / b;
  return Number.isFinite(fps) && fps > 0 && fps < 500 ? Number(fps.toFixed(3)) : null;
}

function tag(s: FfStream, name: string): string | null {
  if (!s.tags) return null;
  const key = Object.keys(s.tags).find((k) => k.toLowerCase() === name);
  const v = key ? s.tags[key] : undefined;
  return v && v !== 'und' ? v : null;
}

/** Maps raw ffprobe JSON to Velyx' media info. Exported for tests. */
export function mapProbeOutput(out: FfOutput, fileName: string): ProbeResult {
  const streams = out.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  const defaultAudio = audios.find((a) => a.disposition?.default) ?? audios[0];
  const ext = fileName.split('.').pop()?.toLowerCase() ?? null;

  return {
    container: ext,
    durationSec: num(out.format?.duration),
    bitrate: num(out.format?.bit_rate),
    videoCodec: video?.codec_name ?? null,
    videoProfile: video?.profile ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: video ? parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate) : null,
    audioCodec: defaultAudio?.codec_name ?? null,
    audioChannels: defaultAudio?.channels ?? null,
    audioTracks: audios.map((a) => ({
      index: a.index,
      codec: a.codec_name ?? null,
      language: tag(a, 'language'),
      channels: a.channels ?? null,
      channelLayout: a.channel_layout ?? null,
      title: tag(a, 'title'),
      isDefault: Boolean(a.disposition?.default),
    })),
    subtitleTracks: subs.map((s) => ({
      index: s.index,
      codec: s.codec_name ?? null,
      language: tag(s, 'language'),
      title: tag(s, 'title'),
      isDefault: Boolean(s.disposition?.default),
      isForced: Boolean(s.disposition?.forced),
      textBased: TEXT_SUBTITLE_CODECS.has(s.codec_name ?? ''),
    })),
  };
}

export function createFfprobe(ffprobePath: string, timeoutMs = 60000): Prober {
  return (file: string) =>
    new Promise((resolve, reject) => {
      execFile(
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', file],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr?.toString().trim() || err.message));
            return;
          }
          try {
            resolve(mapProbeOutput(JSON.parse(stdout) as FfOutput, file));
          } catch (e) {
            reject(e as Error);
          }
        },
      );
    });
}

export function checkBinary(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.toString().split('\n')[0] ?? 'unknown');
    });
  });
}
