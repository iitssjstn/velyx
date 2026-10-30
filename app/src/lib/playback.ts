import type { Api } from './api';
import { sameLanguage } from './subtitles';

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
    /**
     * The same stream in short pieces (HLS), offered once the server knows the file's keyframes (or
     * when the video is converted): seeking stays in one stream instead of starting a new one.
     */
    hlsUrl?: string;
    /** Set by the app: this answer plays the pieces (`streamUrl` is the list), the live stream is `remuxUrl`. */
    hls?: boolean;
    remuxUrl?: string;
  };
  analysis: { mode: 'direct' | 'remux' | 'transcode' | 'unsupported'; problems: string[]; summary: string[] };
  file: { id: number; durationSec: number | null; audioTracks: AudioTrackInfo[] };
  subtitles: SubtitleOption[];
  directPlayback?: { endpoints: { type: 'lan' | 'public'; url: string }[]; token: string };
  /** The server can search subtitles online (OpenSubtitles, with its own key or through vidalune.com). */
  onlineSubtitles?: boolean;
}

/** Where a stream plays from: its address and the file time its time 0 stands for. */
export interface StreamStart {
  uri: string;
  /** Seconds into the file at which this stream begins (0 for direct play). */
  offset: number;
  /** Direct media origin/token when the control API was opened through the relay. */
  mediaBase?: string;
  mediaToken?: string;
}

/**
 * Plays the pieces when the server offers them for a stream that would otherwise restart on every
 * seek: the player then seeks in the list itself (like a file), and the pieces made stay on the server.
 */
export function withHls(answer: PlaybackAnswer): PlaybackAnswer {
  const d = answer.decision;
  if (!d.hlsUrl || d.seek !== 'restart' || d.hls) return answer;
  return { ...answer, decision: { ...d, streamUrl: d.hlsUrl, seek: 'range', hls: true, remuxUrl: d.streamUrl } };
}

/** Back to the live stream (the pieces did not play on this device). */
export function withoutHls(answer: PlaybackAnswer): PlaybackAnswer {
  const d = answer.decision;
  if (!d.hls || !d.remuxUrl) return answer;
  return { ...answer, decision: { ...d, streamUrl: d.remuxUrl, seek: 'restart', hls: false, hlsUrl: undefined, remuxUrl: undefined } };
}

function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/**
 * The stream for a position. Direct play reads the file (the player seeks itself); a remux stream
 * begins at the keyframe before `at`, which the server tells, so positions are offset by it.
 */
export async function streamFrom(api: Api, answer: PlaybackAnswer, at: number, fetchImpl: typeof fetch = fetch, reached?: string): Promise<StreamStart> {
  let mediaBase: string | undefined;
  const mediaToken = answer.directPlayback?.token;
  // The address that answered for this playback before (a seek restarts the stream): not asked
  // again, so a seek does not wait for an address that does not answer (up to 4 s each).
  if (answer.directPlayback && reached && answer.directPlayback.endpoints.some((e) => new URL(e.url).origin === reached)) mediaBase = reached;
  else if (answer.directPlayback) {
    if (!mediaToken || !answer.directPlayback.endpoints.length) throw new Error('No direct media endpoint is available.');
    for (const endpoint of answer.directPlayback.endpoints) {
      try {
        const probe = new URL(`/api/media/${answer.file.id}/stream`, endpoint.url);
        if (answer.decision.optimized) probe.searchParams.set('optimized', String(answer.decision.optimized.id));
        probe.searchParams.set('cast', mediaToken);
        const response = await fetchImpl(probe, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
        if (response.status === 402) throw new Error('Remote access is required to play this file away from home.');
        if (!response.ok) continue;
        mediaBase = new URL(endpoint.url).origin;
        console.info(`connection_mode=direct_${endpoint.type}`);
        break;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Remote access')) throw error;
      }
    }
    if (!mediaBase) {
      console.info('connection_mode=failed');
      throw new Error('No direct media endpoint is reachable.');
    }
  }
  const directUrl = (path: string) => {
    if (!mediaBase || !mediaToken) return api.url(path);
    const url = new URL(path, `${mediaBase}/`);
    url.searchParams.set('cast', mediaToken);
    return url.toString();
  };
  const base = answer.decision.streamUrl;
  if (answer.decision.seek !== 'restart' || at <= 0) return { uri: directUrl(base), offset: 0, ...(mediaBase && mediaToken ? { mediaBase, mediaToken } : {}) };
  const optimized = answer.decision.optimized?.id;
  const r = await api.get<{ start: number; seek: number }>(`/api/media/${answer.file.id}/keyframe?t=${at.toFixed(3)}${optimized ? `&optimized=${optimized}` : ''}`);
  return { uri: directUrl(withParam(base, 'start', r.seek.toFixed(3))), offset: r.start, ...(mediaBase && mediaToken ? { mediaBase, mediaToken } : {}) };
}

/** A subtitle's address for a stream that begins `offset` seconds into the file. */
export function subtitleUrl(api: Api, option: SubtitleOption, offset: number, media?: { baseUrl: string; token: string }): string {
  const url = media ? new URL(option.url, `${media.baseUrl}/`) : new URL(api.url(option.url));
  if (offset > 0) url.searchParams.set('offset', offset.toFixed(3));
  if (media) url.searchParams.set('cast', media.token);
  return url.toString();
}

/** The server's direct address for a stream, with the token that opens it there. */
export interface MediaEndpoint {
  baseUrl: string;
  token: string;
}

/**
 * How a subtitle is fetched: from the direct address when the stream has one (`null`: it has none, so
 * through the API). While the stream's address is still being found (`undefined`) nothing yet: through
 * the API it would go via vidalune.com, which refuses subtitles just like video, and the player said
 * the subtitle could not be loaded while it was only starting.
 */
export function subtitleRequest(api: Api, option: SubtitleOption, endpoint: MediaEndpoint | null | undefined): { url: string; headers: Record<string, string> } | null {
  if (endpoint === undefined) return null;
  return { url: subtitleUrl(api, option, 0, endpoint ?? undefined), headers: endpoint ? {} : api.headers() };
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
 * The audio track to start in for the language last chosen (or the account's language): the track
 * already playing when it has that language, else the default or first one in it. Undefined when the
 * file has no track in that language, or the one playing is already right.
 */
export function preferredAudio(tracks: AudioTrackInfo[], language: string | null | undefined, current: number | null): number | undefined {
  const inLanguage = tracks.filter((t) => sameLanguage(t.language, language));
  if (!inLanguage.length || inLanguage.some((t) => t.index === current)) return undefined;
  return (inLanguage.find((t) => t.isDefault) ?? inLanguage[0]!).index;
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

/**
 * Every file of a title could not be read (empty, cut off by a failed download, damaged): nothing
 * can play it, converted or not, so the title page says so instead of offering Play.
 */
export function noReadableFile(files: { videoCodec?: string | null; probeError?: string | null }[]): boolean {
  return files.length > 0 && files.every((f) => Boolean(f.probeError) && !f.videoCodec);
}
