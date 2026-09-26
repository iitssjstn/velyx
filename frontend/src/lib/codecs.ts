/**
 * Detects what this browser can decode so the server can warn about files that will not direct play.
 * canPlayType is conservative for Matroska: Chromium and Firefox play most MKV files (H.264/VP9/AV1 +
 * AAC/Opus) even though they answer "" for video/x-matroska, so MKV is reported as a container there.
 */
const VIDEO: Record<string, string[]> = {
  h264: ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.42E01E"'],
  hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  vp8: ['video/webm; codecs="vp8"'],
  vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'],
  av1: ['video/mp4; codecs="av01.0.05M.08"', 'video/webm; codecs="av01.0.05M.08"'],
  mpeg4: ['video/mp4; codecs="mp4v.20.8"'],
};

const AUDIO: Record<string, string[]> = {
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  mp3: ['audio/mpeg'],
  opus: ['audio/webm; codecs="opus"', 'audio/ogg; codecs="opus"'],
  vorbis: ['audio/webm; codecs="vorbis"', 'audio/ogg; codecs="vorbis"'],
  flac: ['audio/flac', 'audio/mp4; codecs="flac"'],
  ac3: ['audio/mp4; codecs="ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"'],
};

/** 10-bit variants: HEVC Main10, VP9 profile 2, AV1 10-bit, H.264 High 10 (almost never supported). */
const TEN_BIT: Record<string, string[]> = {
  hevc: ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"'],
  vp9: ['video/webm; codecs="vp09.02.10.10"', 'video/mp4; codecs="vp09.02.10.10"'],
  av1: ['video/mp4; codecs="av01.0.05M.10"'],
  h264: ['video/mp4; codecs="avc1.6E0028"'],
};

const CONTAINERS: Record<string, string[]> = {
  mp4: ['video/mp4'],
  m4v: ['video/mp4', 'video/x-m4v'],
  mov: ['video/quicktime', 'video/mp4'],
  webm: ['video/webm'],
  mkv: ['video/x-matroska', 'video/webm'],
  ogv: ['video/ogg'],
};

export interface Capabilities {
  containers: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  tenBitCodecs: string[];
  /** The screen reports HDR (CSS dynamic-range: high). */
  hdr: boolean;
}

let cached: Capabilities | null = null;

export function detectCapabilities(videoEl?: Pick<HTMLVideoElement, 'canPlayType'>, ua?: string, hdrScreen?: boolean): Capabilities {
  const useCache = !videoEl && !ua;
  if (cached && useCache) return cached;
  const video = videoEl ?? document.createElement('video');
  const userAgent = ua ?? navigator.userAgent;
  const ok = (types: string[]) => types.some((t) => video.canPlayType(t) !== '');
  const pick = (table: Record<string, string[]>) => Object.entries(table).filter(([, t]) => ok(t)).map(([k]) => k);
  const containers = pick(CONTAINERS);
  const isChromiumOrFirefox = /Chrome\/|Chromium\/|Firefox\/|Edg\//.test(userAgent) && !/Edge\/1[0-8]/.test(userAgent);
  if (isChromiumOrFirefox && !containers.includes('mkv')) containers.push('mkv');
  const hdr = hdrScreen ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(dynamic-range: high)').matches);
  const caps = { containers, videoCodecs: pick(VIDEO), audioCodecs: pick(AUDIO), tenBitCodecs: pick(TEN_BIT), hdr };
  if (useCache) cached = caps;
  return caps;
}
