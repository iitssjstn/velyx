import { Link } from 'react-router-dom';
import { codecName, deviceName, formatClock, formatRelative, resolutionLabel } from '../lib/format';
import type { ActiveStream, HistoryEntry } from '../lib/types';
import { intlLocale, t, useT } from '../i18n';

/** "AAC 5.1 · voices boosted" as the server records it, in the interface language. */
function audioConversionLabel(text: string): string {
  return text
    .replace(/\bstereo\b/, t('media.stereo').toLowerCase())
    .replace('voices boosted', t('playback.voicesBoosted'))
    .replace('volume levelled', t('playback.volumeLevelled'));
}

type StreamInfo = Pick<ActiveStream, 'mode' | 'audioConversion' | 'container' | 'videoCodec' | 'audioCodec' | 'width' | 'height' | 'bitrate'>;

/** "Direct Play", "Remux" or "Remux · Audio → AAC 5.1". */
export function modeLabel(s: Pick<StreamInfo, 'mode' | 'audioConversion'>): string {
  if (s.mode === 'direct') return t('playback.directPlay');
  return s.audioConversion ? t('playback.remuxAudio', { target: audioConversionLabel(s.audioConversion) }) : t('playback.remux');
}

/** What is sent: e.g. "HEVC · 4K · 20.0 Mbps · MKV → MP4 · E-AC3 → AAC 5.1". */
export function streamFormat(s: StreamInfo): string {
  const container = s.container ? s.container.toUpperCase() : null;
  const audio = codecName(s.audioCodec);
  return [
    codecName(s.videoCodec),
    resolutionLabel(s.width, s.height),
    s.bitrate ? `${(s.bitrate / 1_000_000).toFixed(1)} Mbps` : null,
    container && (s.mode === 'remux' ? `${container} → MP4` : container),
    audio && (s.mode === 'remux' && s.audioConversion ? `${audio} → ${audioConversionLabel(s.audioConversion.split(' · ')[0])}` : audio),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Minutes of watching, readable: "45 s", "12 min", "1 h 05 min". */
export function formatWatched(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return t('time.seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.minutes', { n: m });
  return t('time.hoursMinutes', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
}

export function itemHref(s: Pick<HistoryEntry, 'movieId' | 'episodeId' | 'showId'>): string | null {
  if (s.movieId) return `/movies/${s.movieId}`;
  if (s.showId) return `/shows/${s.showId}`;
  return null;
}

/** One live stream: who, what, where in the item, and exactly how it is sent. */
export function StreamRow({ s, now = Date.now() }: { s: ActiveStream; now?: number }) {
  useT();
  const running = Math.max(0, Math.floor((now - s.startedAt) / 1000));
  const progress = s.positionSec !== null && s.durationSec ? Math.min(1, s.positionSec / s.durationSec) : null;
  const href = itemHref(s);
  return (
    <li className="py-3">
      <div className="grid gap-1 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {href ? <Link to={href} className="hover:text-accent">{s.title}</Link> : s.title}
            {s.subtitle && <span className="font-normal text-muted"> · {s.subtitle}</span>}
          </p>
          <p className="truncate text-xs text-faint">
            {s.username}
            {s.device && ` · ${deviceName(s.device)}`}
          </p>
        </div>
        <span className={`w-fit rounded-full px-2 py-0.5 text-xs ${s.mode === 'direct' ? 'bg-ok/15 text-ok' : 'bg-accent/15 text-accent'}`}>{modeLabel(s)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{streamFormat(s)}</p>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted tabular-nums">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
          {progress !== null && <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />}
        </div>
        <span title={t('activity.position')}>{s.positionSec !== null && s.durationSec ? `${formatClock(s.positionSec)} / ${formatClock(s.durationSec)}` : '—'}</span>
        <span title={t('activity.watchingFor')}>{formatClock(running)}</span>
      </div>
    </li>
  );
}

/** One viewing: what, who (for admins), when, how long, and how it was sent. */
export function HistoryRow({ h, showUser }: { h: HistoryEntry; showUser: boolean }) {
  useT();
  const href = itemHref(h);
  const progress = h.positionSec !== null && h.durationSec ? Math.round((h.positionSec / h.durationSec) * 100) : null;
  return (
    <li className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:gap-4">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {href ? <Link to={href} className="hover:text-accent">{h.title}</Link> : h.title}
          {h.subtitle && <span className="font-normal text-muted"> · {h.subtitle}</span>}
        </p>
        <p className="truncate text-xs text-faint">
          {[showUser ? h.username : null, h.device ? deviceName(h.device) : null, streamFormat(h)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted sm:flex-col sm:items-end">
        <span title={new Date(h.startedAt).toLocaleString(intlLocale())}>{h.endedAt === null ? <span className="text-ok">{t('activity.playingNow')}</span> : formatRelative(h.startedAt)}</span>
        <span className="tabular-nums">
          {t('activity.watchedFor', { time: formatWatched(h.watchedSec) })}{progress !== null ? ` · ${progress}%` : ''} · <span className={h.mode === 'direct' ? 'text-ok' : 'text-accent'}>{modeLabel(h)}</span>
        </span>
      </div>
    </li>
  );
}
