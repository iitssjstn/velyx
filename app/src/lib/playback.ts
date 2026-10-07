import type { Api } from './api';

/** What the device's decoders report (see modules/vidalune-codecs). */
export interface Decoders {
  videoCodecs: string[];
  tenBitCodecs: string[];
  audioCodecs: string[];
  hdr: boolean;
}

/** What the app tells the server it can play (POST /api/media/:id/playback). */
export interface PlaybackCaps {
  containers: string[];
  videoCodecs: string[];
  tenBitCodecs: string[];
  audioCodecs: string[];
  hdr: boolean;
  audioTrackSwitching: boolean;
  imageSubtitles: boolean;
  audioIndex?: number;
}

/** Containers the app's player (Media3/ExoPlayer) reads, whatever the device. */
export const CONTAINERS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'ts', 'avi'];

/** Without a decoder report: what every Android device decodes (in software if need be). */
const FALLBACK: Decoders = { videoCodecs: ['h264', 'vp8', 'vp9'], tenBitCodecs: [], audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'], hdr: false };

export function playbackCaps(decoders: Decoders | null, audioIndex?: number): PlaybackCaps {
  const d = decoders && decoders.videoCodecs.length ? decoders : FALLBACK;
  return {
    containers: CONTAINERS,
    videoCodecs: [...new Set(d.videoCodecs)],
    tenBitCodecs: [...new Set(d.tenBitCodecs)],
    audioCodecs: [...new Set(d.audioCodecs)],
    hdr: d.hdr,
    audioTrackSwitching: true,
    // Image-based subtitles (PGS) are not shown by the app yet.
    imageSubtitles: false,
    ...(audioIndex !== undefined ? { audioIndex } : {}),
  };
}

/** Formats every Android device plays; asked for when playing the original file failed after all. */
const SAFE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

/**
 * A second try after direct play failed on the device (its decoder list promised more than it
 * could do): the video stays as it is — Vidalune never transcodes it — but the server is asked to
 * repackage the file as MP4 and convert the audio, which fixes most failures.
 */
export function fallbackCaps(caps: PlaybackCaps): PlaybackCaps {
  return { ...caps, containers: ['mp4'], audioCodecs: caps.audioCodecs.filter((c) => SAFE_AUDIO.includes(c)), audioTrackSwitching: false };
}

export interface AudioTrackInfo {
  index: number;
  codec: string | null;
  language: string | null;
  languageName?: string | null;
  channels: number | null;
  title: string | null;
  isDefault: boolean;
}

export interface SubtitleOption {
  key: string;
  kind: 'external' | 'embedded' | 'online';
  label: string;
  language: string | null;
  languageName: string | null;
  title: string | null;
  forced: boolean;
  isDefault: boolean;
  url: string;
}

export interface PlaybackAnswer {
  decision: {
    engine: string;
    mode: 'direct' | 'remux' | 'transcode' | 'unsupported';
    streamUrl: string;
    optimized?: { id: number; profile: 'compat-720p' | 'compat-1080p' };
    compatible: boolean | 'unknown';
    /** 'range': seek in the file; 'restart': ask for a new stream from the new position. */
    seek: 'range' | 'restart';
    audioIndex: number | null;
    durationSec: number | null;
  };
  analysis: { mode: 'direct' | 'remux' | 'transcode' | 'unsupported'; problems: string[]; summary: string[] };
  file: { id: number; durationSec: number | null; audioTracks: AudioTrackInfo[] };
  subtitles: SubtitleOption[];
  /** The server can search subtitles online (OpenSubtitles, with its own key or through vidalune.com). */
  onlineSubtitles?: boolean;
}

/** Where a stream plays from: its address and the file time its time 0 stands for. */
export interface StreamStart {
  uri: string;
  /** Seconds into the file at which this stream begins (0 for direct play). */
  offset: number;
}

function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/**
 * The stream for a position. Direct play reads the file (the player seeks itself); a remux stream
 * begins at the keyframe before `at`, which the server tells, so positions are offset by it.
 */
export async function streamFrom(api: Api, answer: PlaybackAnswer, at: number): Promise<StreamStart> {
  const base = answer.decision.streamUrl;
  if (answer.decision.seek !== 'restart' || at <= 0) return { uri: api.url(base), offset: 0 };
  const optimized = answer.decision.optimized?.id;
  const r = await api.get<{ start: number; seek: number }>(`/api/media/${answer.file.id}/keyframe?t=${at.toFixed(3)}${optimized ? `&optimized=${optimized}` : ''}`);
  return { uri: api.url(withParam(base, 'start', r.seek.toFixed(3))), offset: r.start };
}

/** A subtitle's address for a stream that begins `offset` seconds into the file. */
export function subtitleUrl(api: Api, option: SubtitleOption, offset: number): string {
  return api.url(offset > 0 ? withParam(option.url, 'offset', offset.toFixed(3)) : option.url);
}

/**
 * Which of the player's audio tracks is the file's audio track `index` (ffprobe numbering). The
 * player lists a file's audio tracks in the same order, so the position among them matches.
 */
export function playerAudioPosition(tracks: AudioTrackInfo[], index: number | null): number {
  if (index === null) return -1;
  return [...tracks].sort((a, b) => a.index - b.index).findIndex((t) => t.index === index);
}

/**
 * Where playback resumes, or null to start from the beginning: from 30 seconds in, and not in the
 * last part (the last 15 seconds or 10 %, where the credits usually are) — as on the website, so
 * continuing an episode never lands in its credits and the "next episode" card.
 */
export function resumePoint(progress: { positionSec: number; durationSec: number; completed?: boolean } | null | undefined): number | null {
  if (!progress || progress.completed || progress.positionSec < 30) return null;
  if (progress.durationSec > 0 && (progress.durationSec - progress.positionSec < 15 || progress.positionSec / progress.durationSec >= 0.9)) return null;
  return progress.positionSec;
}

/** How far before the end a stream may stop and still count as the end of the file. */
const END_MARGIN_SEC = 30;

/**
 * What the player reporting "played to the end" means:
 * - `ignore`: no stream is playing yet. A player without a video (it exists before the video is
 *   loaded) reports its end straight away; that is not the end of the episode.
 * - `resume`: the stream broke off long before the end (a dropped connection, a stalled server):
 *   playback continues from there instead of offering the next episode and marking it watched.
 * - `end`: the real end of the file.
 */
export function endOfStream(streamReady: boolean, position: number, duration: number): 'ignore' | 'resume' | 'end' {
  if (!streamReady) return 'ignore';
  return duration > 0 && position < duration - END_MARGIN_SEC ? 'resume' : 'end';
}

/** Attempts to continue a stream that broke off, counted per spot in the file. */
export interface Retries {
  at: number;
  count: number;
}

export const NO_RETRIES: Retries = { at: -1, count: 0 };

/**
 * Whether playback may continue once more at `position`: up to three times at the same spot
 * (within 10 seconds); a new spot starts counting again. A stream that keeps failing at one place
 * is reported instead of being restarted forever.
 */
export function retryAt(previous: Retries, position: number): { retries: Retries; allowed: boolean } {
  const count = Math.abs(position - previous.at) < 10 ? previous.count + 1 : 1;
  return { retries: { at: position, count }, allowed: count <= 3 };
}

/**
 * Whether the picture is still loading. The player's own status can stay on "loading" after a
 * buffering pause or a seek on some Android devices while the video already plays again: time that
 * moves forward while playing means it is not loading, whatever the status says.
 */
export function stillLoading(statusLoading: boolean, previousTime: number, time: number, playing: boolean): boolean {
  if (!statusLoading) return false;
  return !(playing && time > previousTime + 0.05);
}
