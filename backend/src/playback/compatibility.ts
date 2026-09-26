import type { ClientCapabilities, MediaFileRow, PlaybackDecision } from './engine.js';
import { clientProfile } from './client-profile.js';

/**
 * One place that knows what a browser can decode. The playback engines use it to make their
 * decision, the player uses the resulting analysis to explain it, and the compatibility overview
 * applies it to whole libraries (with a reference browser profile) using cached FFprobe data only.
 */

export type PlaybackMode = 'direct' | 'remux' | 'unsupported';

/** Video codecs FFmpeg can copy into fragmented MP4 without re-encoding. */
export const COPYABLE_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9']);
/** Containers every current browser opens for playback (MKV works in Chromium and Firefox). */
const REFERENCE_CONTAINERS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
/** What a current Chrome/Edge on a typical PC decodes; used when the client did not report capabilities. */
export const REFERENCE_CAPS: Required<Pick<ClientCapabilities, 'containers' | 'videoCodecs' | 'audioCodecs' | 'tenBitCodecs'>> = {
  containers: REFERENCE_CONTAINERS,
  videoCodecs: ['h264', 'vp8', 'vp9', 'av1'],
  audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'],
  tenBitCodecs: ['vp9', 'av1'],
};

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC / H.265',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  mpeg4: 'MPEG-4 Part 2 (DivX/Xvid)',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  vc1: 'VC-1',
  wmv3: 'WMV 9',
  msmpeg4v3: 'MS MPEG-4',
  theora: 'Theora',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  ac3: 'Dolby Digital (AC3)',
  eac3: 'Dolby Digital Plus (E-AC3)',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
  subrip: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MP4 text',
};

export function codecLabel(codec: string | null | undefined): string {
  if (!codec) return 'Unknown';
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

/** Browser name from a User-Agent header, for messages only (never for decisions). */
export function browserName(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return null;
}

function reported(caps: ClientCapabilities): boolean {
  return Boolean(caps.videoCodecs?.length || caps.audioCodecs?.length || caps.containers?.length);
}

export interface VideoSupport {
  /** true = decodable, false = not, 'unknown' = the client did not tell us. */
  ok: boolean | 'unknown';
  problem: string | null;
}

/** Whether the client can decode the file's video stream (codec and bit depth). */
export function videoSupport(file: Pick<MediaFileRow, 'videoCodec' | 'videoBitDepth'>, caps: ClientCapabilities): VideoSupport {
  const codec = file.videoCodec;
  if (!codec) return { ok: 'unknown', problem: null };
  const isReported = Boolean(caps.videoCodecs?.length);
  const codecs = isReported ? caps.videoCodecs! : REFERENCE_CAPS.videoCodecs;
  if (!codecs.includes(codec)) {
    if (!isReported && codec === 'hevc') return { ok: 'unknown', problem: 'HEVC plays only in browsers with HEVC support (Safari, and Chrome or Edge with hardware decoding).' };
    return { ok: isReported ? false : 'unknown', problem: `This browser cannot decode ${codecLabel(codec)} video.` };
  }
  const depth = file.videoBitDepth ?? 8;
  if (depth > 8) {
    // Only trust the 10-bit list when the client sent one (older clients only report codecs).
    const tenBit = caps.tenBitCodecs ?? (isReported ? null : REFERENCE_CAPS.tenBitCodecs);
    if (codec === 'h264') return { ok: false, problem: `${depth}-bit H.264 (Hi10P) cannot be decoded by web browsers.` };
    if (tenBit && !tenBit.includes(codec)) return { ok: isReported ? false : 'unknown', problem: `This browser cannot decode ${depth}-bit ${codecLabel(codec)} video.` };
  }
  return { ok: true, problem: null };
}

export interface PlaybackAnalysis {
  mode: PlaybackMode;
  browser: string | null;
  video: {
    codec: string | null;
    label: string;
    width: number | null;
    height: number | null;
    bitDepth: number | null;
    range: string | null;
    /** direct = the browser reads the original file; copy = remuxed without re-encoding. */
    action: 'direct' | 'copy' | 'unsupported';
  };
  audio: {
    codec: string | null;
    label: string;
    channels: number | null;
    action: 'direct' | 'copy' | 'convert' | 'none';
    /** e.g. "AAC stereo" when converted. */
    target: string | null;
  };
  container: { name: string | null; action: 'direct' | 'remux' };
  /** Why the file cannot play (empty when it can). */
  problems: string[];
  /** Things that work but are worth knowing (HDR, image subtitles, …). */
  warnings: string[];
  /** Playing this would need video transcoding, which Velyx does not do. */
  transcodeRequired: boolean;
  /** Velyx never re-encodes video in this version. */
  serverTranscoding: false;
  /** Rough server load for this stream. */
  serverLoad: 'none' | 'low';
  /** "Chrome on Windows"; null when the device cannot be recognised. */
  device: string | null;
  /**
   * How sure the verdict is: the device reported its formats, Velyx used the defaults for this
   * kind of browser, or it assumed a typical browser.
   */
  confidence: 'reported' | 'profile' | 'assumed';
  /** Per stream: can this device handle it, and what happens to it. */
  components: Record<'video' | 'audio' | 'container', { status: ComponentStatus; note: string }>;
  /** A few plain sentences that explain the decision. */
  summary: string[];
  /** Embedded subtitle formats: text ones can be shown, image ones (PGS/VobSub) cannot. */
  subtitles: { text: string[]; image: string[] };
}

/** ok = fine, warn = converted or repackaged, fail = cannot play here, unknown = cannot be confirmed. */
export type ComponentStatus = 'ok' | 'warn' | 'fail' | 'unknown';

function hdrWarning(range: string | null, caps: ClientCapabilities): string | null {
  if (!range || range === 'SDR') return null;
  if (range === 'DV') return 'Dolby Vision video: browsers show the HDR10 base layer when present; colours can look off without it.';
  if (caps.hdr === false) return `${range} video on a screen without HDR: colours may look washed out.`;
  return null;
}

/**
 * Explains a playback decision: what happens to each stream, why, and whether it can work at all.
 * `decision` is the engine's choice for the same file, capabilities and options.
 */
export function analyzePlayback(
  file: MediaFileRow,
  caps: ClientCapabilities,
  decision: Pick<PlaybackDecision, 'engine' | 'compatible' | 'audioIndex' | 'note' | 'streamUrl'>,
  userAgent?: string,
  confidence: PlaybackAnalysis['confidence'] = reported(caps) ? 'reported' : 'assumed',
): PlaybackAnalysis {
  const video = videoSupport(file, caps);
  const isReported = confidence !== 'assumed';
  const profile = clientProfile(userAgent);
  const track = (file.audioTracks ?? []).find((t) => t.index === decision.audioIndex) ?? null;
  const audioCodec = track?.codec ?? file.audioCodec;
  const problems: string[] = [];
  const warnings: string[] = [];

  let mode: PlaybackMode;
  if (video.ok === false) mode = 'unsupported';
  else if (decision.engine === 'remux') mode = 'remux';
  else if (decision.compatible === false) mode = 'unsupported';
  else mode = 'direct';

  if (video.problem) (video.ok === false ? problems : warnings).push(video.problem);
  if (mode === 'unsupported' && !problems.length) {
    if (file.videoCodec && !COPYABLE_VIDEO.has(file.videoCodec)) problems.push(`${codecLabel(file.videoCodec)} video cannot be played in browsers without transcoding.`);
    else problems.push('This browser reported that it cannot play this file.');
  }

  const converting = mode === 'remux' && decision.audioIndex !== null && !decision.streamUrl.includes('copy=1');
  const channels = /&ch=6/.test(decision.streamUrl) ? '5.1' : 'stereo';
  const audioAction: PlaybackAnalysis['audio']['action'] =
    decision.audioIndex === null && !audioCodec ? 'none' : mode === 'remux' ? (converting ? 'convert' : 'copy') : 'direct';

  const hdr = hdrWarning(file.videoRange, caps);
  if (hdr) warnings.push(hdr);
  const imageSubs = (file.subtitleTracks ?? []).filter((s) => !s.textBased);
  if (imageSubs.length) {
    const names = [...new Set(imageSubs.map((s) => codecLabel(s.codec)))].join('/');
    warnings.push(`${imageSubs.length} image-based subtitle track${imageSubs.length === 1 ? '' : 's'} (${names}) cannot be shown; text subtitles work.`);
  }
  if (!isReported && mode !== 'unsupported') warnings.push('This device did not report which formats it supports, so Velyx assumed a typical browser.');
  if (confidence === 'profile') warnings.push(`This device did not report which formats it supports, so Velyx used what ${profile.name} usually plays.`);

  // ---- per-stream status and a plain-language summary
  const audioSupported = !audioCodec || (caps.audioCodecs ?? REFERENCE_CAPS.audioCodecs).includes(audioCodec);
  const containerSupported = !file.container || (caps.containers ?? REFERENCE_CAPS.containers).includes(file.container);
  const target = audioAction === 'convert' ? `AAC ${channels}` : null;
  const components: PlaybackAnalysis['components'] = {
    video:
      mode === 'unsupported' && video.ok !== true
        ? { status: video.ok === 'unknown' ? 'unknown' : 'fail', note: problems[0] ?? video.problem ?? 'This device cannot decode this video.' }
        : mode === 'unsupported'
          ? { status: 'fail', note: problems[0] ?? 'This device cannot decode this video.' }
          : video.ok === 'unknown'
            ? { status: 'unknown', note: video.problem ?? 'Velyx cannot confirm that this device decodes it.' }
            : { status: 'ok', note: mode === 'remux' ? 'Copied without re-encoding' : 'Plays as-is' },
    audio:
      audioAction === 'none'
        ? { status: 'ok', note: 'No audio track' }
        : audioAction === 'convert'
          ? { status: 'warn', note: `Converted to ${target}${audioSupported ? ' (for your audio settings or track choice)' : ''}` }
          : mode === 'unsupported'
            ? audioSupported
              ? { status: 'ok', note: 'Supported' }
              : audioCodec === 'aac'
                ? { status: 'fail', note: 'This browser cannot play AAC audio' }
                : { status: 'warn', note: 'Would be converted to AAC' }
            : { status: 'ok', note: audioAction === 'copy' ? 'Copied as-is' : 'Plays as-is' },
    container: containerSupported
      ? { status: 'ok', note: mode === 'remux' ? 'Supported; streamed as MP4 while remuxing' : 'Supported' }
      : { status: 'warn', note: mode === 'unsupported' ? 'Would be repackaged as MP4' : 'Repackaged as MP4' },
  };
  const summary: string[] = [];
  if (mode === 'direct') summary.push('No server-side conversion required.');
  else if (mode === 'remux') {
    summary.push('The video does not need transcoding.');
    summary.push(audioAction === 'convert' ? `Velyx remuxes the file and converts the audio to ${target}, which uses little CPU.` : 'Velyx will remux the media for compatibility, which uses little CPU.');
  } else {
    summary.push(components.video.status === 'unknown' ? 'This device may not be able to play this video format.' : 'Your current browser/device cannot play this video format.');
    summary.push('Server transcoding: No. Velyx does not convert video.');
  }
  if (mode !== 'unsupported' && components.video.status === 'unknown') summary.push('Velyx cannot confirm that this device decodes the video. If it does not start, try another browser or device.');
  if (confidence !== 'reported') summary.push('This is an estimate: the device did not report which formats it supports.');

  return {
    mode,
    browser: browserName(userAgent),
    video: {
      codec: file.videoCodec,
      label: codecLabel(file.videoCodec),
      width: file.width,
      height: file.height,
      bitDepth: file.videoBitDepth,
      range: file.videoRange,
      action: mode === 'unsupported' ? 'unsupported' : mode === 'remux' ? 'copy' : 'direct',
    },
    audio: {
      codec: audioCodec,
      label: codecLabel(audioCodec),
      channels: track?.channels ?? file.audioChannels,
      action: audioAction,
      target: audioAction === 'convert' ? `AAC ${channels}` : null,
    },
    container: { name: file.container, action: mode === 'remux' ? 'remux' : 'direct' },
    problems,
    warnings,
    transcodeRequired: mode === 'unsupported',
    serverTranscoding: false,
    serverLoad: mode === 'remux' ? 'low' : 'none',
    device: profile.family === 'unknown' && !profile.browser ? null : profile.name,
    confidence,
    components,
    summary,
    subtitles: {
      text: [...new Set((file.subtitleTracks ?? []).filter((t) => t.textBased).map((t) => codecLabel(t.codec)))],
      image: [...new Set(imageSubs.map((t) => codecLabel(t.codec)))],
    },
  };
}

export type LibraryVerdict = 'direct' | 'remux' | 'browser-dependent' | 'incompatible' | 'unknown';

/**
 * Compatibility of a file for a typical current browser, from cached FFprobe data only.
 * Used by the per-library overview; the player makes the real decision per device.
 */
export function libraryVerdict(file: Pick<MediaFileRow, 'container' | 'videoCodec' | 'videoBitDepth' | 'audioCodec' | 'probeError'>): LibraryVerdict {
  if (file.probeError || !file.videoCodec) return 'unknown';
  const video = videoSupport(file, {});
  if (video.ok === false) return 'incompatible';
  if (!COPYABLE_VIDEO.has(file.videoCodec) && !REFERENCE_CAPS.videoCodecs.includes(file.videoCodec)) return 'incompatible';
  if (video.ok === 'unknown') return file.videoCodec === 'hevc' ? 'browser-dependent' : 'incompatible';
  const containerOk = REFERENCE_CAPS.containers.includes(file.container ?? '');
  const audioOk = !file.audioCodec || REFERENCE_CAPS.audioCodecs.includes(file.audioCodec);
  return containerOk && audioOk ? 'direct' : 'remux';
}

/** Short problem labels for a file, for grouping in the compatibility overview. */
export function fileIssues(file: Pick<MediaFileRow, 'container' | 'videoCodec' | 'videoBitDepth' | 'videoRange' | 'audioCodec' | 'subtitleTracks'>): string[] {
  const issues: string[] = [];
  if (file.videoCodec === 'hevc') issues.push('HEVC video');
  if (file.videoCodec === 'av1') issues.push('AV1 video');
  if (file.videoCodec && !COPYABLE_VIDEO.has(file.videoCodec) && file.videoCodec !== 'vp8') issues.push(`${codecLabel(file.videoCodec)} video`);
  if ((file.videoBitDepth ?? 8) > 8) issues.push(file.videoCodec === 'h264' ? '10-bit H.264' : '10-bit video');
  if (file.videoRange && file.videoRange !== 'SDR') issues.push(file.videoRange === 'DV' ? 'Dolby Vision' : 'HDR');
  if (file.audioCodec && !REFERENCE_CAPS.audioCodecs.includes(file.audioCodec)) issues.push(`${codecLabel(file.audioCodec)} audio`);
  if (file.container && !REFERENCE_CAPS.containers.includes(file.container)) issues.push(`${file.container.toUpperCase()} container`);
  if ((file.subtitleTracks ?? []).some((s) => !s.textBased)) issues.push('Image subtitles (PGS/VobSub)');
  return issues;
}
