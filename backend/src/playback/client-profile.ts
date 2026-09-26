import type { ClientCapabilities } from './engine.js';

/**
 * Lightweight client profiles: a name for the device ("Chrome on Windows") and, only for clients
 * that do not report what they can decode, a conservative guess per browser family. The browser's
 * own report (canPlayType) always wins; this is not a device database.
 */

export type ProfileFamily = 'chromium' | 'firefox' | 'safari' | 'ios' | 'android' | 'unknown';

export interface ClientProfile {
  family: ProfileFamily;
  browser: string | null;
  os: string | null;
  /** "Chrome on Windows", "Safari on iPhone", or "Unknown device". */
  name: string;
  mobile: boolean;
}

function detectOs(ua: string): { os: string | null; mobile: boolean } {
  if (/iPhone|iPod/.test(ua)) return { os: 'iPhone', mobile: true };
  if (/iPad/.test(ua)) return { os: 'iPad', mobile: true };
  if (/Android/.test(ua)) return { os: 'Android', mobile: true };
  if (/CrOS/.test(ua)) return { os: 'ChromeOS', mobile: false };
  if (/Windows/.test(ua)) return { os: 'Windows', mobile: false };
  if (/Mac OS X|Macintosh/.test(ua)) return { os: 'macOS', mobile: false };
  if (/Linux/.test(ua)) return { os: 'Linux', mobile: false };
  return { os: null, mobile: false };
}

function detectBrowser(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

export function clientProfile(userAgent: string | undefined): ClientProfile {
  const ua = userAgent ?? '';
  const { os, mobile } = detectOs(ua);
  const browser = detectBrowser(ua);
  let family: ProfileFamily = 'unknown';
  // Every browser on iPhone/iPad uses Apple's WebKit engine and its decoders.
  if (os === 'iPhone' || os === 'iPad') family = 'ios';
  else if (os === 'Android' && browser && browser !== 'Firefox') family = 'android';
  else if (browser === 'Firefox') family = 'firefox';
  else if (browser === 'Safari') family = 'safari';
  else if (browser) family = 'chromium';
  const name = browser && os ? `${browser} on ${os}` : browser ?? (os ? `Browser on ${os}` : 'Unknown device');
  return { family, browser, os, name, mobile };
}

type Caps = Required<Pick<ClientCapabilities, 'containers' | 'videoCodecs' | 'audioCodecs' | 'tenBitCodecs'>>;

/** What each family decodes on practically every device. Codecs that need hardware support are left out. */
const DEFAULTS: Record<Exclude<ProfileFamily, 'unknown'>, Caps> = {
  chromium: { containers: ['mp4', 'm4v', 'mov', 'webm', 'mkv'], videoCodecs: ['h264', 'vp8', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'], tenBitCodecs: ['vp9', 'av1'] },
  firefox: { containers: ['mp4', 'm4v', 'webm', 'mkv'], videoCodecs: ['h264', 'vp8', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'], tenBitCodecs: ['vp9', 'av1'] },
  safari: { containers: ['mp4', 'm4v', 'mov'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'mp3', 'flac', 'ac3', 'eac3'], tenBitCodecs: ['hevc'] },
  ios: { containers: ['mp4', 'm4v', 'mov'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'mp3', 'flac', 'ac3', 'eac3'], tenBitCodecs: ['hevc'] },
  android: { containers: ['mp4', 'm4v', 'webm', 'mkv'], videoCodecs: ['h264', 'vp8', 'vp9'], audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac'], tenBitCodecs: ['vp9'] },
};

/** Codecs whose support depends on the device's hardware for a family. */
const HARDWARE_DEPENDENT: Record<ProfileFamily, string[]> = {
  chromium: ['hevc'],
  firefox: ['hevc'],
  safari: ['av1', 'vp9'],
  ios: ['av1', 'vp9'],
  android: ['hevc', 'av1'],
  unknown: ['hevc', 'av1'],
};

export function hasCapabilities(caps: ClientCapabilities): boolean {
  return Boolean(caps.videoCodecs?.length || caps.audioCodecs?.length || caps.containers?.length);
}

/** Capabilities to decide with: the client's own report, else the family's conservative defaults. */
export function effectiveCapabilities(caps: ClientCapabilities, profile: ClientProfile): { caps: ClientCapabilities; confidence: 'reported' | 'profile' | 'assumed' } {
  if (hasCapabilities(caps)) return { caps, confidence: 'reported' };
  if (profile.family === 'unknown') return { caps, confidence: 'assumed' };
  return { caps: { ...DEFAULTS[profile.family], hdr: caps.hdr }, confidence: 'profile' };
}

export type SupportLevel = 'yes' | 'no' | 'converted' | 'depends';

export interface DeviceSupportRow {
  key: string;
  kind: 'video' | 'audio' | 'container' | 'display';
  label: string;
  support: SupportLevel;
  note: string | null;
}

const ROWS: Array<{ key: string; kind: DeviceSupportRow['kind']; label: string }> = [
  { key: 'h264', kind: 'video', label: 'H.264' },
  { key: 'hevc', kind: 'video', label: 'HEVC / H.265' },
  { key: 'hevc10', kind: 'video', label: '10-bit HEVC' },
  { key: 'av1', kind: 'video', label: 'AV1' },
  { key: 'vp9', kind: 'video', label: 'VP9' },
  { key: 'h264-10', kind: 'video', label: '10-bit H.264' },
  { key: 'aac', kind: 'audio', label: 'AAC' },
  { key: 'mp3', kind: 'audio', label: 'MP3' },
  { key: 'opus', kind: 'audio', label: 'Opus' },
  { key: 'flac', kind: 'audio', label: 'FLAC' },
  { key: 'ac3', kind: 'audio', label: 'Dolby Digital (AC3)' },
  { key: 'eac3', kind: 'audio', label: 'Dolby Digital Plus (E-AC3)' },
  { key: 'dts', kind: 'audio', label: 'DTS' },
  { key: 'truehd', kind: 'audio', label: 'Dolby TrueHD' },
  { key: 'mp4', kind: 'container', label: 'MP4' },
  { key: 'mkv', kind: 'container', label: 'MKV' },
  { key: 'hdr', kind: 'display', label: 'HDR screen' },
];

/**
 * What the current device plays, for the "Current device" overview. Answers from the browser's own
 * report are stated plainly; guesses (no report) are marked as "depends".
 */
export function deviceSupport(reportedCaps: ClientCapabilities, profile: ClientProfile): DeviceSupportRow[] {
  const { caps, confidence } = effectiveCapabilities(reportedCaps, profile);
  const guess = confidence !== 'reported';
  const hw = HARDWARE_DEPENDENT[profile.family];
  const video = caps.videoCodecs ?? [];
  const tenBit = caps.tenBitCodecs ?? [];
  const audio = caps.audioCodecs ?? [];
  const containers = caps.containers ?? [];
  return ROWS.map(({ key, kind, label }) => {
    const row = (support: SupportLevel, note: string | null = null): DeviceSupportRow => ({ key, kind, label, support, note });
    if (kind === 'video') {
      if (key === 'h264-10') return row('no', 'No web browser decodes it; Velyx does not transcode video.');
      const codec = key === 'hevc10' ? 'hevc' : key;
      const base = video.includes(codec);
      const ok = key === 'hevc10' ? base && tenBit.includes('hevc') : base;
      if (ok) return row(guess ? 'depends' : 'yes', guess ? 'Usually supported by this browser.' : hw.includes(codec) ? 'Uses hardware decoding on this device.' : null);
      if (guess || hw.includes(codec)) return row(guess ? 'depends' : 'no', hw.includes(codec) ? 'Depends on hardware decoding support.' : 'Could not be confirmed on this device.');
      return row('no', 'Needs transcoding, which Velyx does not do.');
    }
    if (kind === 'audio') {
      if (audio.includes(key)) return row(guess ? 'depends' : 'yes');
      // Converted audio becomes AAC, so a browser without AAC cannot be helped.
      if (key === 'aac') return row(guess ? 'depends' : 'no', 'Most files use AAC audio, and converted audio is AAC too.');
      return row('converted', 'Velyx converts it to AAC while playing.');
    }
    if (kind === 'container') {
      if (containers.includes(key)) return row(guess ? 'depends' : 'yes');
      return row('converted', 'Velyx repackages it as MP4 while playing.');
    }
    if (caps.hdr === true) return row('yes');
    if (caps.hdr === false) return row('no', 'HDR video plays, but colours can look washed out.');
    return row('depends');
  });
}
