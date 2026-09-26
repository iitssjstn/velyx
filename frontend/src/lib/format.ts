import { intlLocale, t } from '../i18n';
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
  if (h === 0) return t('time.minutesShort', { m });
  return m === 0 ? t('time.hoursShort', { h }) : t('time.hoursMinutesShort', { h, m });
}

/** 1:02:03 / 37:24 / 0:05 */
/** Reads "1:23:45", "12:34", "95" or "95.5" as seconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$|^\d+:[0-5]?\d(\.\d+)?$|^\d+:[0-5]?\d:[0-5]?\d(\.\d+)?$/.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

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
  const digits = v >= 100 || i === 0 ? 0 : 1;
  // Written the way the interface language writes numbers ("3.4 TB" / "3,4 TB").
  return `${v.toLocaleString(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })} ${units[i]}`;
}

export function formatBitrate(bps: number | null | undefined): string | null {
  if (!bps) return null;
  const n = (v: number, digits: number) => v.toLocaleString(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  return bps >= 1_000_000 ? `${n(bps / 1_000_000, 1)} Mbps` : `${n(bps / 1000, 0)} kbps`;
}

export function formatDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}${/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'T00:00:00' : ''}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(intlLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return t('time.never');
  const diff = Math.round((now - ts) / 1000);
  if (diff < 45) return t('time.justNow');
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
  return new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' }).format(-Math.round(value), unit);
}

export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return t('time.daysHoursShort', { d, h });
  if (h > 0) return t('time.hoursMinutesShort', { h, m });
  return t('time.minutesShort', { m });
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return t('greeting.night');
  if (h < 12) return t('greeting.morning');
  if (h < 18) return t('greeting.afternoon');
  return t('greeting.evening');
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
  if (channels === 1) return t('media.mono');
  if (channels === 2) return t('media.stereo');
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return t('media.channels', { n: channels });
}

export function progressFraction(p: { positionSec: number; durationSec: number } | null | undefined): number {
  if (!p || !p.durationSec) return 0;
  return Math.min(1, Math.max(0, p.positionSec / p.durationSec));
}

/** "in 3 h", "in 25 min", "in 2 days", or "now" for a moment in the future. */
export function formatIn(ts: number, now = Date.now()): string {
  const min = Math.round((ts - now) / 60_000);
  if (min <= 0) return t('time.now');
  if (min < 60) return t('time.inMinutes', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('time.inHours', { n: h });
  return t('time.inDays', { n: Math.round(h / 24) });
}

/** Plain description of the automatic scan schedule. */
export function scheduleLabel(s: { intervalMinutes: number; nextAt: number | null; waitingForPlayback: boolean }, now = Date.now()): string {
  if (s.intervalMinutes <= 0 || !s.nextAt) return t('schedule.off');
  if (s.waitingForPlayback) return t('schedule.waitingForPlayback');
  return t('schedule.next', { when: formatIn(s.nextAt, now), interval: intervalLabel(s.intervalMinutes).toLowerCase() });
}

export function intervalLabel(minutes: number): string {
  if (minutes <= 0) return t('schedule.off');
  if (minutes % 1440 === 0) return t('schedule.everyDays', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('schedule.everyHours', { count: minutes / 60 });
  return t('schedule.everyMinutes', { count: minutes });
}

/** "2160p · HEVC · HDR10 · Blu-ray · 18.2 GB" for a replaced or replacing file. */
export function snapshotLabel(s: { width: number | null; height: number | null; videoCodec: string | null; videoRange: string | null; source: string | null; size: number }): string {
  const res = !s.width || !s.height ? null : s.width >= 3200 || s.height >= 2000 ? '2160p' : s.width >= 1800 || s.height >= 1000 ? '1080p' : s.width >= 1200 || s.height >= 700 ? '720p' : `${s.height}p`;
  const codec = s.videoCodec ? ({ h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' } as Record<string, string>)[s.videoCodec] ?? s.videoCodec.toUpperCase() : null;
  return [res, codec, s.videoRange && s.videoRange !== 'SDR' ? (s.videoRange === 'DV' ? 'Dolby Vision' : s.videoRange) : null, s.source, formatBytes(s.size)].filter(Boolean).join(' · ');
}

/**
 * A device as the server stored it ("Chrome on Windows", "Unknown device"), in the interface
 * language. Browser and system names stay as they are.
 */
export function deviceName(text: string | null | undefined): string {
  if (!text || text === 'Unknown device') return t('device.unknown');
  const word = (w: string) => (w === 'Browser' ? t('device.browser') : w === 'Script' ? t('device.script') : w);
  const m = /^(.+) on (.+)$/.exec(text);
  return m ? t('device.on', { browser: word(m[1]), os: m[2] }) : word(text);
}
