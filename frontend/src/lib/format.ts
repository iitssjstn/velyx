/** Artwork is proxied (and cached) by the server: never load TMDB URLs directly in the browser. */
export function imageUrl(path: string | null | undefined, size: 'w92' | 'w185' | 'w300' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w342'): string | null {
  if (!path) return null;
  return `/api/images/${size}/${path.replace(/^\//, '')}`;
}

/** 2h 49m / 47m */
export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 1:02:03 / 37:24 / 0:05 */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatBitrate(bps: number | null | undefined): string | null {
  if (!bps) return null;
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

export function formatDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}${/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'T00:00:00' : ''}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const diff = Math.round((now - ts) / 1000);
  if (diff < 45) return 'just now';
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let value = diff;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [step, u] of units) {
    unit = u;
    if (Math.abs(value) < step) break;
    value = value / step;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(value), unit);
}

export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  if (width >= 3800 || height >= 2100) return '4K';
  if (width >= 2500 || height >= 1400) return '1440p';
  if (width >= 1900 || height >= 1000) return '1080p';
  if (width >= 1200 || height >= 700) return '720p';
  if (height >= 560) return '576p';
  return `${height}p`;
}

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  aac: 'AAC',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital+',
  dts: 'DTS',
  truehd: 'TrueHD',
  flac: 'FLAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  subrip: 'SRT',
  ass: 'ASS',
  mov_text: 'MP4 text',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
  webvtt: 'WebVTT',
};

export function codecName(codec: string | null | undefined): string | null {
  if (!codec) return null;
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

export function channelLabel(channels: number | null | undefined): string | null {
  if (!channels) return null;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels} ch`;
}

export function progressFraction(p: { positionSec: number; durationSec: number } | null | undefined): number {
  if (!p || !p.durationSec) return 0;
  return Math.min(1, Math.max(0, p.positionSec / p.durationSec));
}
