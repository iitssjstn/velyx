import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Check,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { detectCapabilities } from '../lib/codecs';
import { episodeCode, formatClock, imageUrl } from '../lib/format';
import { getPrefs, sameLanguage, setPrefs, SUBTITLE_SIZES, usePrefs } from '../lib/prefs';
import { isTyping, pickSubtitle, startPosition } from '../lib/player';
import type { EpisodeDetail, MediaFileInfo, MovieDetail, PlaybackInfo } from '../lib/types';
import { Spinner } from '../components/States';

const SAVE_INTERVAL_MS = 10_000;
const HIDE_CONTROLS_MS = 3000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface LoadedItem {
  kind: 'movie' | 'episode';
  id: number;
  title: string;
  subtitle: string | null;
  backHref: string;
  backdrop: string | null;
  files: MediaFileInfo[];
  progress: MovieDetail['progress'];
  next: EpisodeDetail['next'];
}

async function loadItem(kind: string, id: number): Promise<LoadedItem> {
  if (kind === 'movie') {
    const m = await api.get<MovieDetail>(`/api/movies/${id}`);
    return { kind: 'movie', id, title: m.title, subtitle: m.year ? String(m.year) : null, backHref: `/movies/${id}`, backdrop: m.backdropPath, files: m.files, progress: m.progress, next: null };
  }
  const e = await api.get<EpisodeDetail>(`/api/episodes/${id}`);
  return {
    kind: 'episode',
    id,
    title: e.showTitle,
    subtitle: `${episodeCode(e.seasonNumber, e.episodeNumber)}${e.title ? ` — ${e.title}` : ''}`,
    backHref: `/shows/${e.showId}?season=${e.seasonNumber}`,
    backdrop: e.stillPath ?? e.showBackdropPath,
    files: e.files,
    progress: e.progress,
    next: e.next,
  };
}

/** Minimal typing for the (not yet universal) HTMLMediaElement.audioTracks API. */
interface BrowserAudioTrack {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}
type AudioTrackList = { length: number; [index: number]: BrowserAudioTrack; addEventListener?: (t: string, cb: () => void) => void };

function saveProgress(item: LoadedItem, position: number, duration: number, keepalive = false) {
  if (!duration || !Number.isFinite(duration)) return;
  const body = JSON.stringify({ [item.kind === 'movie' ? 'movieId' : 'episodeId']: item.id, positionSec: Math.floor(position), durationSec: Math.floor(duration) });
  // keepalive lets the request finish when the page is being closed or navigated away from.
  return fetch('/api/progress', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive }).catch(() => undefined);
}

export default function PlayerPage() {
  const { kind = 'movie', id: idParam } = useParams();
  const id = Number(idParam);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const prefs = usePrefs();

  const item = useQuery({ queryKey: ['play-item', kind, id], queryFn: () => loadItem(kind, id), gcTime: 0, staleTime: Infinity });
  const fileParam = Number(params.get('file'));
  const file = item.data?.files.find((f) => f.id === fileParam) ?? item.data?.files[0];
  const playback = useQuery({
    queryKey: ['playback', file?.id],
    enabled: Boolean(file),
    gcTime: 0,
    staleTime: Infinity,
    queryFn: () => api.post<PlaybackInfo>(`/api/media/${file!.id}/playback`, detectCapabilities()),
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(prefs.volume);
  const [muted, setMuted] = useState(prefs.muted);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<null | 'subs' | 'audio' | 'speed'>(null);
  const [subKey, setSubKey] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [audioTracks, setAudioTracks] = useState<BrowserAudioTrack[]>([]);
  const [seekHover, setSeekHover] = useState<{ x: number; t: number } | null>(null);
  const startedRef = useRef(false);
  const lastSaveRef = useRef(0);

  const info = playback.data;
  const subs = useMemo(() => info?.subtitles ?? [], [info]);
  const next = item.data?.next ?? null;
  const start = useMemo(() => startPosition(params.get('t'), item.data?.progress), [params, item.data?.progress]);

  // ---------------------------------------------------------------- controls visibility
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControlsVisible(false);
        setMenu(null);
      }
    }, HIDE_CONTROLS_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ---------------------------------------------------------------- actions
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.5, v.currentTime + delta));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void wrapRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const applyVolume = useCallback((v: number, m: boolean) => {
    const el = videoRef.current;
    if (el) {
      el.volume = v;
      el.muted = m;
    }
    setVolume(v);
    setMuted(m);
    setPrefs({ volume: v, muted: m });
  }, []);

  const selectSubtitle = useCallback(
    (key: string | null) => {
      setSubKey(key);
      const v = videoRef.current;
      if (!v) return;
      for (let i = 0; i < v.textTracks.length; i++) {
        const track = v.textTracks[i]!;
        track.mode = subs[i]?.key === key ? 'showing' : 'disabled';
      }
    },
    [subs],
  );

  const selectAudio = useCallback((trackId: string) => {
    const list = (videoRef.current as unknown as { audioTracks?: AudioTrackList } | null)?.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i]!.enabled = list[i]!.id === trackId;
    setAudioTracks(Array.from({ length: list.length }, (_, i) => ({ ...list[i]!, id: list[i]!.id, label: list[i]!.label, language: list[i]!.language, enabled: list[i]!.enabled })));
  }, []);

  const goNext = useCallback(() => {
    if (!next) return;
    setCountdown(null);
    navigate(`/play/episode/${next.id}`, { replace: true });
  }, [navigate, next]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (window.history.length > 1) navigate(-1);
    else if (item.data) navigate(item.data.backHref);
    else navigate('/');
  }, [navigate, item.data]);

  // ---------------------------------------------------------------- reset when the item changes (auto-next)
  useEffect(() => {
    startedRef.current = false;
    setEnded(false);
    setCountdown(null);
    setError(null);
    setWarningDismissed(false);
    setTime(0);
    setDuration(0);
    setBuffering(true);
  }, [kind, id]);

  // ---------------------------------------------------------------- video element events
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    v.volume = volume;
    v.muted = muted;
    v.playbackRate = speed;
    if (!startedRef.current) {
      startedRef.current = true;
      if (start > 0 && start < v.duration - 5) v.currentTime = start;
      // Default subtitle according to preferences.
      selectSubtitle(pickSubtitle(subs, getPrefs().subtitleLanguage));
      // Preferred audio language when the browser supports switching.
      const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
      if (list && list.length > 0) {
        const pref = getPrefs().audioLanguage;
        const tracks = Array.from({ length: list.length }, (_, i) => list[i]!);
        const match = pref ? tracks.find((t) => sameLanguage(t.language, pref)) : undefined;
        if (match) for (const t of tracks) t.enabled = t === match;
        setAudioTracks(tracks.map((t) => ({ id: t.id, label: t.label, language: t.language, enabled: t.enabled })));
      }
      void v.play().catch(() => {
        // Autoplay with sound can be blocked; the user just presses play.
        setPlaying(false);
        setBuffering(false);
      });
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !item.data) return;
    setTime(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    const now = Date.now();
    if (!v.paused && now - lastSaveRef.current > SAVE_INTERVAL_MS) {
      lastSaveRef.current = now;
      void saveProgress(item.data, v.currentTime, v.duration);
    }
  };

  const onPause = () => {
    setPlaying(false);
    setControlsVisible(true);
    const v = videoRef.current;
    if (v && item.data && startedRef.current) void saveProgress(item.data, v.currentTime, v.duration);
  };

  const onEnded = () => {
    setEnded(true);
    setPlaying(false);
    setControlsVisible(true);
    const v = videoRef.current;
    if (v && item.data) void saveProgress(item.data, v.duration, v.duration)?.then(() => qc.invalidateQueries({ queryKey: ['home'] }));
    if (next && getPrefs().autoplayNext) setCountdown(getPrefs().autoplayCountdown);
  };

  const onError = () => {
    const v = videoRef.current;
    const code = v?.error?.code;
    const reasons = info?.decision.reasons ?? [];
    if (code === 4 || code === 3) {
      setError(
        reasons.length
          ? `Your browser cannot play this file: ${reasons.join('; ')}. Velyx currently plays files directly (no transcoding yet).`
          : 'Your browser cannot decode this file. Try another browser (Chrome/Edge handle the most formats) — transcoding arrives in a future Velyx version.',
      );
    } else if (code === 2) {
      setError('The connection to the server was interrupted.');
    } else {
      setError('Playback failed. The file may be unavailable — try rescanning the library.');
    }
    setBuffering(false);
  };

  // ---------------------------------------------------------------- auto-next countdown
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, goNext]);

  // ---------------------------------------------------------------- save on leave
  useEffect(() => {
    const onHide = () => {
      const v = videoRef.current;
      if (v && item.data && startedRef.current && !v.ended) void saveProgress(item.data, v.currentTime, v.duration, true);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['movie'] });
      void qc.invalidateQueries({ queryKey: ['show'] });
    };
  }, [item.data, qc]);

  // ---------------------------------------------------------------- fullscreen state
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = videoRef.current;
      poke();
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          if ((e.target as HTMLElement)?.tagName === 'BUTTON' && e.key === ' ') return;
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          applyVolume(Math.min(1, (v?.volume ?? volume) + 0.1), false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          applyVolume(Math.max(0, (v?.volume ?? volume) - 0.1), muted);
          break;
        case 'm':
        case 'M':
          applyVolume(volume, !muted);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'c':
        case 'C': {
          if (!subs.length) break;
          const idx = subs.findIndex((s) => s.key === subKey);
          selectSubtitle(idx + 1 < subs.length ? subs[idx + 1]!.key : null);
          break;
        }
        case 'n':
        case 'N':
          if (next) goNext();
          break;
        case 'Escape':
          if (menu) setMenu(null);
          else if (!document.fullscreenElement) exit();
          break;
        default:
          if (/^[0-9]$/.test(e.key) && v?.duration) v.currentTime = (v.duration * Number(e.key)) / 10;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, togglePlay, seekBy, applyVolume, toggleFullscreen, selectSubtitle, goNext, exit, subs, subKey, next, menu, volume, muted]);

  useEffect(() => {
    wrapRef.current?.style.setProperty('--velyx-sub-size', SUBTITLE_SIZES[prefs.subtitleSize]);
  }, [prefs.subtitleSize]);

  // ---------------------------------------------------------------- render
  const loadError = item.error ?? playback.error;
  if (loadError || (item.data && !file)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-black px-6 text-center">
        <div>
          <TriangleAlert className="mx-auto size-10 text-amber" />
          <h1 className="mt-4 font-display text-2xl font-semibold">Cannot play this item</h1>
          <p className="mt-2 text-muted">{loadError ? errorMessage(loadError) : 'There is no media file for this item. Try rescanning the library.'}</p>
          <button type="button" onClick={exit} className="mt-6 h-10 rounded-lg bg-raised px-4">Go back</button>
        </div>
      </div>
    );
  }

  const showWarning = info && info.decision.compatible === false && prefs.showCompatibilityWarnings && !warningDismissed && !error;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const fileAudio = file?.audioTracks ?? [];
  const canSwitchAudio = audioTracks.length > 1;
  const showUi = controlsVisible || !playing || menu !== null;

  return (
    <div
      ref={wrapRef}
      className={`fixed inset-0 z-50 bg-black text-ink select-none ${showUi ? '' : 'cursor-none'}`}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      {info && (
        <video
          key={info.decision.streamUrl}
          ref={videoRef}
          src={info.decision.streamUrl}
          className="h-full w-full"
          preload="metadata"
          playsInline
          poster={imageUrl(item.data?.backdrop, 'w1280') ?? undefined}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
            setCountdown(null);
            poke();
          }}
          onPause={onPause}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onSeeked={() => {
            const v = videoRef.current;
            if (v && item.data && startedRef.current) void saveProgress(item.data, v.currentTime, v.duration);
          }}
          onEnded={onEnded}
          onError={onError}
          onClick={() => {
            if (menu) setMenu(null);
            else togglePlay();
          }}
          onDoubleClick={toggleFullscreen}
        >
          {subs.map((s) => (
            <track key={s.key} kind="subtitles" src={s.url} label={s.label} srcLang={s.language ?? undefined} />
          ))}
        </video>
      )}

      {(buffering || !info) && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner className="size-10" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 px-6 text-center">
          <div className="max-w-lg">
            <TriangleAlert className="mx-auto size-10 text-amber" />
            <h2 className="mt-4 font-display text-2xl font-semibold">Playback problem</h2>
            <p className="mt-2 text-muted">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={exit} className="h-10 rounded-lg bg-raised px-4">Go back</button>
              {next && (
                <button type="button" onClick={goNext} className="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">Next episode</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showWarning && (
        <div className="absolute top-20 left-1/2 z-10 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-amber/30 bg-black/80 px-4 py-3 text-sm backdrop-blur">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
          <p className="flex-1 text-ink/85">
            This file may not play in this browser: {info!.decision.reasons.join('; ')}. Velyx will try anyway.
          </p>
          <button type="button" className="text-muted hover:text-ink" onClick={() => setWarningDismissed(true)}>Dismiss</button>
        </div>
      )}

      {/* Auto-next overlay */}
      {ended && next && !error && (
        <div className="absolute right-6 bottom-28 z-20 w-80 overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-2xl backdrop-blur">
          {next.stillPath && <img src={imageUrl(next.stillPath, 'w300') ?? ''} alt="" className="aspect-video w-full object-cover" />}
          <div className="p-4">
            <p className="text-xs text-muted">Up next {episodeCode(next.seasonNumber, next.episodeNumber)}</p>
            <p className="truncate font-medium">{next.title ?? `Episode ${next.episodeNumber}`}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={goNext} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-ink font-semibold text-bg">
                <Play className="size-4 fill-current" />
                {countdown !== null ? `Play in ${countdown}` : 'Play now'}
              </button>
              {countdown !== null && (
                <button type="button" onClick={() => setCountdown(null)} className="h-9 rounded-lg bg-raised px-3 text-sm">Cancel</button>
              )}
            </div>
          </div>
        </div>
      )}
      {ended && !next && !error && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60">
          <div className="text-center">
            <p className="font-display text-2xl font-semibold">Finished</p>
            <div className="mt-4 flex justify-center gap-3">
              <button type="button" onClick={() => { const v = videoRef.current; if (v) { v.currentTime = 0; void v.play(); } }} className="flex h-10 items-center gap-2 rounded-lg bg-raised px-4">
                <RotateCcw className="size-4" /> Watch again
              </button>
              <Link to={item.data?.backHref ?? '/'} className="flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">Done</Link>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className={`absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-12 transition-opacity duration-300 sm:px-6 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <button type="button" onClick={exit} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold">{item.data?.title}</p>
          {item.data?.subtitle && <p className="truncate text-sm text-ink/70">{item.data.subtitle}</p>}
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-4 transition-opacity duration-300 sm:px-6 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Seek bar */}
        <div
          className="group relative h-5"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
            setSeekHover({ x, t: duration ? (x / r.width) * duration : 0 });
          }}
          onMouseLeave={() => setSeekHover(null)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-all group-hover:h-1.5">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          </div>
          {seekHover && duration > 0 && (
            <span className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums" style={{ left: seekHover.x }}>
              {formatClock(seekHover.t)}
            </span>
          )}
          <input
            type="range"
            className="seek absolute inset-0 h-full w-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            aria-label="Seek"
            aria-valuetext={formatClock(time)}
            onChange={(e) => {
              const v = videoRef.current;
              if (v) v.currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
          />
        </div>

        <div className="mt-2 flex items-center gap-1 sm:gap-2">
          <button type="button" onClick={togglePlay} className="grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
          </button>
          <button type="button" onClick={() => seekBy(-10)} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Back 10 seconds" title="Back 10 s (←)">
            <RotateCcw className="size-5" />
          </button>
          <button type="button" onClick={() => seekBy(10)} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Forward 10 seconds" title="Forward 10 s (→)">
            <RotateCw className="size-5" />
          </button>
          <div className="group/vol hidden items-center sm:flex">
            <button type="button" onClick={() => applyVolume(volume, !muted)} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label={muted ? 'Unmute' : 'Mute'}>
              <VolumeIcon className="size-5" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value), Number(e.target.value) === 0)}
              className="w-0 accent-[var(--color-accent)] opacity-0 transition-all group-hover/vol:w-24 group-hover/vol:opacity-100 focus-visible:w-24 focus-visible:opacity-100"
              aria-label="Volume"
            />
          </div>
          <span className="ml-2 text-sm text-ink/80 tabular-nums">
            {formatClock(time)} <span className="text-ink/40">/ {formatClock(duration)}</span>
          </span>

          <div className="relative ml-auto flex items-center gap-1">
            {next && (
              <button type="button" onClick={goNext} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Next episode" title="Next episode (N)">
                <SkipForward className="size-5" />
              </button>
            )}
            <button type="button" onClick={() => setMenu(menu === 'subs' ? null : 'subs')} className={`grid size-10 place-items-center rounded-full hover:bg-white/10 ${subKey ? 'text-accent' : ''}`} aria-label="Subtitles" title="Subtitles (C)">
              <Captions className="size-5" />
            </button>
            {fileAudio.length > 1 && (
              <button type="button" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Audio track">
                <AudioLines className="size-5" />
              </button>
            )}
            <button type="button" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Playback speed">
              <Gauge className="size-5" />
            </button>
            <button type="button" onClick={toggleFullscreen} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">
              {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </button>

            {menu && (
              <div className="absolute right-0 bottom-14 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-line bg-surface/95 py-2 shadow-2xl backdrop-blur" role="menu">
                {menu === 'subs' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">Subtitles</p>
                    <MenuItem active={subKey === null} onClick={() => { selectSubtitle(null); setMenu(null); }}>Off</MenuItem>
                    {subs.map((s) => (
                      <MenuItem key={s.key} active={subKey === s.key} onClick={() => { selectSubtitle(s.key); setMenu(null); }}>
                        {s.label}
                        <span className="ml-2 text-xs text-faint">{s.kind === 'embedded' ? 'embedded' : 'file'}</span>
                      </MenuItem>
                    ))}
                    {subs.length === 0 && <p className="px-4 py-2 text-sm text-muted">No text subtitles found for this file.</p>}
                    {(file?.embeddedSubtitles.some((s) => !s.textBased) ?? false) && (
                      <p className="px-4 pt-2 text-xs text-faint">Image-based subtitles (PGS/VobSub) need transcoding and are not available yet.</p>
                    )}
                    <div className="mt-2 border-t border-line/60 px-4 pt-2">
                      <p className="pb-1 text-xs text-faint">Size</p>
                      <div className="flex gap-1">
                        {(['small', 'medium', 'large'] as const).map((sz) => (
                          <button key={sz} type="button" onClick={() => setPrefs({ subtitleSize: sz })} className={`flex-1 rounded-md py-1 text-xs capitalize ${prefs.subtitleSize === sz ? 'bg-accent text-accent-ink' : 'bg-raised'}`}>
                            {sz}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {menu === 'audio' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">Audio</p>
                    {canSwitchAudio
                      ? audioTracks.map((t, i) => (
                          <MenuItem key={t.id || i} active={t.enabled} onClick={() => { selectAudio(t.id); setMenu(null); }}>
                            {t.label || fileAudio[i]?.title || fileAudio[i]?.languageName || t.language || `Track ${i + 1}`}
                          </MenuItem>
                        ))
                      : (
                        <>
                          {fileAudio.map((a) => (
                            <div key={a.index} className="px-4 py-1.5 text-sm text-muted">
                              {a.languageName ?? a.title ?? 'Unknown'} {a.isDefault && <span className="text-xs text-faint">(default)</span>}
                            </div>
                          ))}
                          <p className="px-4 pt-2 text-xs text-faint">This browser plays the default track only. Safari supports switching; other browsers need transcoding (planned).</p>
                        </>
                      )}
                  </>
                )}
                {menu === 'speed' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">Speed</p>
                    {SPEEDS.map((s) => (
                      <MenuItem
                        key={s}
                        active={speed === s}
                        onClick={() => {
                          setSpeed(s);
                          if (videoRef.current) videoRef.current.playbackRate = s;
                          setMenu(null);
                        }}
                      >
                        {s === 1 ? 'Normal' : `${s}×`}
                      </MenuItem>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={active} onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-raised">
      <Check className={`size-4 shrink-0 ${active ? 'text-accent' : 'invisible'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
