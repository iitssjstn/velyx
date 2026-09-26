import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { channelLabel, codecName, episodeCode, formatClock, imageUrl } from '../lib/format';
import { getPrefs, normalizeLanguage, sameLanguage, setPrefs, usePrefs, type PlaybackPrefs } from '../lib/prefs';
import { isTyping, pickSubtitle, preferredAudioIndex, seekPlan, startPosition, withParam } from '../lib/player';
import type { EpisodeDetail, MediaFileInfo, MovieDetail, PlaybackInfo } from '../lib/types';
import { Spinner } from '../components/States';
import { SubtitleOverlay } from '../components/SubtitleOverlay';

const SAVE_INTERVAL_MS = 10_000;
const HIDE_CONTROLS_MS = 3000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** Only Safari exposes HTMLMediaElement.audioTracks by default; elsewhere the server switches tracks. */
const NATIVE_AUDIO_SWITCHING = typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype;

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

/** Asks the server where a live stream for `target` will really begin (the keyframe FFmpeg lands on). */
async function locateStart(fileId: number, target: number): Promise<{ offset: number; seek: number }> {
  try {
    const r = await api.get<{ start: number; seek: number }>(`/api/media/${fileId}/keyframe?t=${target.toFixed(3)}`);
    return { offset: r.start, seek: r.seek };
  } catch {
    return { offset: target, seek: target };
  }
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

  // Audio track to ask the server for. null = not decided yet, undefined = the file's default.
  const [audioChoice, setAudioChoice] = useState<number | undefined | null>(null);
  useEffect(() => {
    if (file && audioChoice === null) setAudioChoice(preferredAudioIndex(file.audioTracks, getPrefs().audioLanguage, NATIVE_AUDIO_SWITCHING));
  }, [file, audioChoice]);

  const audioPrefs = { audioChannels: prefs.audioOutput, boostVoices: prefs.boostVoices, levelVolume: prefs.levelVolume };
  const playback = useQuery({
    queryKey: ['playback', file?.id, audioChoice, audioPrefs.audioChannels, audioPrefs.boostVoices, audioPrefs.levelVolume],
    enabled: Boolean(file) && audioChoice !== null,
    gcTime: 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.post<PlaybackInfo>(`/api/media/${file!.id}/playback`, {
        ...detectCapabilities(),
        ...audioPrefs,
        ...(audioChoice !== undefined && audioChoice !== null ? { audioIndex: audioChoice } : {}),
      }),
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
  // The stream to load: `base` is the decision's URL. Live (restart) streams are requested with
  // &start=`seek` and really begin at `offset` seconds into the file (the keyframe FFmpeg lands on).
  const [stream, setStream] = useState<{ base: string; offset: number; seek: number } | null>(null);
  const startedRef = useRef(false);
  const lastSaveRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const resumeAtRef = useRef<number | null>(null);
  const playAfterLoadRef = useRef(true);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subKeyRef = useRef<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<{ video: HTMLVideoElement; track: TextTrack } | null>(null);
  const [subDelay, setSubDelay] = useState(0);

  const info = playback.data;
  const live = info?.decision.seek === 'restart';
  // Only use a stream that belongs to the current decision (avoids loading a stale URL after an audio switch).
  const current = stream && info && stream.base === info.decision.streamUrl ? stream : null;
  const offset = live && current ? current.offset : 0;
  const subs = useMemo(() => info?.subtitles ?? [], [info]);
  const next = item.data?.next ?? null;
  const start = useMemo(() => startPosition(params.get('t'), item.data?.progress), [params, item.data?.progress]);
  const totalDuration = live ? (info?.decision.durationSec ?? file?.durationSec ?? 0) : duration;
  const streamSrc = current ? (live && current.seek > 0 ? withParam(current.base, 'start', current.seek.toFixed(3)) : current.base) : null;

  /** Current position in the file (not in the current stream). */
  const currentTime = useCallback(() => offset + (videoRef.current?.currentTime ?? 0), [offset]);

  // ---------------------------------------------------------------- stream (re)initialisation
  // Decide where the stream starts whenever a new playback decision arrives (first load or audio switch).
  useEffect(() => {
    if (!info) return;
    const target = resumeAtRef.current ?? (startedRef.current ? 0 : start);
    resumeAtRef.current = null;
    pendingSeekRef.current = target > 0 ? target : null;
    const base = info.decision.streamUrl;
    if (stream && stream.base === base) {
      // Same stream as before (e.g. a setting changed that does not affect this file): nothing to reload.
      pendingSeekRef.current = null;
      setBuffering(false);
      return;
    }
    if (info.decision.seek !== 'restart' || target <= 0) {
      setStream({ base, offset: 0, seek: 0 });
      return;
    }
    let cancelled = false;
    setStream(null);
    locateStart(info.file.id, target).then((r) => !cancelled && setStream({ base, ...r }));
    return () => {
      cancelled = true;
    };
    // `stream` is read only to detect "unchanged"; re-running on its changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, start]);

  /** Requests a new live stream starting at the keyframe before `target` (debounced while scrubbing). */
  const restartAt = useCallback(
    (target: number) => {
      if (!info) return;
      clearTimeout(restartTimer.current);
      setTime(target);
      restartTimer.current = setTimeout(async () => {
        const v = videoRef.current;
        playAfterLoadRef.current = v ? !v.paused || !startedRef.current : true;
        setBuffering(true);
        const r = await locateStart(info.file.id, target);
        pendingSeekRef.current = target;
        setStream({ base: info.decision.streamUrl, ...r });
      }, 250);
    },
    [info],
  );
  useEffect(() => () => clearTimeout(restartTimer.current), []);

  const seekTo = useCallback(
    (target: number) => {
      const v = videoRef.current;
      if (!v) return;
      const max = Math.max(0, (totalDuration || v.duration || 0) - 0.5);
      const t = Math.max(0, Math.min(max, target));
      if (!live) {
        v.currentTime = t;
        return;
      }
      const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      const plan = seekPlan(t, offset, end);
      if ('local' in plan) {
        clearTimeout(restartTimer.current);
        v.currentTime = plan.local;
      } else restartAt(t);
    },
    [live, offset, totalDuration, restartAt],
  );

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

  const seekBy = useCallback((delta: number) => seekTo(currentTime() + delta), [seekTo, currentTime]);

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
      subKeyRef.current = key;
      const v = videoRef.current;
      if (!v) return;
      let selected: TextTrack | null = null;
      for (let i = 0; i < v.textTracks.length; i++) {
        const track = v.textTracks[i]!;
        // "hidden" loads the cues without the browser drawing them; SubtitleOverlay renders them.
        const on = subs[i]?.key === key;
        track.mode = on ? 'hidden' : 'disabled';
        if (on) selected = track;
      }
      setActiveTrack(selected ? { video: v, track: selected } : null);
    },
    [subs],
  );

  /** A subtitle picked by the viewer: apply it and remember the choice for the next episode or movie. */
  const chooseSubtitle = useCallback(
    (key: string | null) => {
      selectSubtitle(key);
      const opt = key ? subs.find((o) => o.key === key) : undefined;
      setPrefs(
        opt
          ? { subtitleLanguage: normalizeLanguage(opt.language), subtitleForced: opt.forced, subtitleLabel: opt.language ? '' : opt.label }
          : { subtitleLanguage: '', subtitleForced: false, subtitleLabel: '' },
      );
    },
    [selectSubtitle, subs],
  );

  /** Changes an audio setting and reloads the stream at the current position when needed. */
  const changeAudioPrefs = useCallback(
    (patch: Partial<Pick<PlaybackPrefs, 'audioOutput' | 'boostVoices' | 'levelVolume'>>) => {
      const v = videoRef.current;
      if (startedRef.current) {
        resumeAtRef.current = currentTime();
        playAfterLoadRef.current = v ? !v.paused : true;
      }
      setPrefs(patch);
    },
    [currentTime],
  );

  /** Native switching (Safari) when direct playing; otherwise ask the server for a stream with that track. */
  const selectNativeAudio = useCallback((trackId: string) => {
    const list = (videoRef.current as unknown as { audioTracks?: AudioTrackList } | null)?.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i]!.enabled = list[i]!.id === trackId;
    setAudioTracks(Array.from({ length: list.length }, (_, i) => ({ id: list[i]!.id, label: list[i]!.label, language: list[i]!.language, enabled: list[i]!.enabled })));
  }, []);

  const selectServerAudio = useCallback(
    (index: number) => {
      if (index === info?.decision.audioIndex) return;
      const v = videoRef.current;
      resumeAtRef.current = currentTime();
      playAfterLoadRef.current = v ? !v.paused : true;
      setBuffering(true);
      setAudioChoice(index);
    },
    [info, currentTime],
  );

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
    pendingSeekRef.current = null;
    resumeAtRef.current = null;
    playAfterLoadRef.current = true;
    setAudioChoice(null);
    setStream(null);
    setSubDelay(0);
    setActiveTrack(null);
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
    if (!live) setDuration(v.duration);
    v.volume = volume;
    v.muted = muted;
    v.playbackRate = speed;
    const pending = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (pending !== null) {
      const local = pending - offset;
      if (local > 0.05 && (live || local < v.duration - 1)) v.currentTime = local;
    }
    if (!startedRef.current) {
      startedRef.current = true;
      const p = getPrefs();
      selectSubtitle(pickSubtitle(subs, { language: p.subtitleLanguage, forced: p.subtitleForced, label: p.subtitleLabel }));
      // Preferred audio language in browsers that switch tracks natively (direct play only).
      const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
      if (!live && list && list.length > 0) {
        const pref = getPrefs().audioLanguage;
        const tracks = Array.from({ length: list.length }, (_, i) => list[i]!);
        const match = pref ? tracks.find((t) => sameLanguage(t.language, pref)) : undefined;
        if (match) for (const t of tracks) t.enabled = t === match;
        setAudioTracks(tracks.map((t) => ({ id: t.id, label: t.label, language: t.language, enabled: t.enabled })));
      }
    } else {
      // A new stream (seek or audio switch) re-created the text tracks: restore the chosen subtitle.
      selectSubtitle(subKeyRef.current);
    }
    if (playAfterLoadRef.current) {
      void v.play().catch(() => {
        // Autoplay with sound can be blocked; the user just presses play.
        setPlaying(false);
        setBuffering(false);
      });
    } else setBuffering(false);
    playAfterLoadRef.current = true;
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !item.data) return;
    const t = offset + v.currentTime;
    setTime(t);
    if (v.buffered.length) setBuffered(offset + v.buffered.end(v.buffered.length - 1));
    const now = Date.now();
    if (!v.paused && now - lastSaveRef.current > SAVE_INTERVAL_MS) {
      lastSaveRef.current = now;
      void saveProgress(item.data, t, totalDuration || v.duration);
    }
  };

  const onPause = () => {
    setPlaying(false);
    setControlsVisible(true);
    const v = videoRef.current;
    if (v && item.data && startedRef.current && !v.ended) void saveProgress(item.data, currentTime(), totalDuration || v.duration);
  };

  const onEnded = () => {
    setEnded(true);
    setPlaying(false);
    setControlsVisible(true);
    const v = videoRef.current;
    const total = totalDuration || v?.duration || 0;
    if (v && item.data) void saveProgress(item.data, total, total)?.then(() => qc.invalidateQueries({ queryKey: ['home'] }));
    if (next && getPrefs().autoplayNext) setCountdown(getPrefs().autoplayCountdown);
  };

  const onError = () => {
    const v = videoRef.current;
    const code = v?.error?.code;
    const reasons = info?.decision.reasons ?? [];
    if (code === 4 || code === 3) {
      setError(
        reasons.length
          ? `Your browser cannot play this file: ${reasons.join('; ')}. Velyx converts audio automatically, but this video format would need full transcoding, which is not supported yet.`
          : 'Your browser cannot decode this file. Try Chrome or Edge, which handle the most formats.',
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
  const saveStateRef = useRef({ offset, total: totalDuration });
  saveStateRef.current = { offset, total: totalDuration };
  useEffect(() => {
    const onHide = () => {
      const v = videoRef.current;
      const { offset: o, total } = saveStateRef.current;
      if (v && item.data && startedRef.current && !v.ended) void saveProgress(item.data, o + v.currentTime, total || v.duration, true);
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
          chooseSubtitle(idx + 1 < subs.length ? subs[idx + 1]!.key : null);
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
          if (/^[0-9]$/.test(e.key) && totalDuration) seekTo((totalDuration * Number(e.key)) / 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, togglePlay, seekBy, seekTo, applyVolume, toggleFullscreen, chooseSubtitle, goNext, exit, subs, subKey, next, menu, volume, muted, totalDuration]);


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
      {info && streamSrc && (
        <video
          key={streamSrc}
          ref={videoRef}
          src={streamSrc}
          className="h-full w-full"
          preload="metadata"
          playsInline
          poster={imageUrl(item.data?.backdrop, 'w1280') ?? undefined}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={() => !live && setDuration(videoRef.current?.duration ?? 0)}
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
            if (v && item.data && startedRef.current) void saveProgress(item.data, offset + v.currentTime, totalDuration || v.duration);
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
            // Live streams start at `offset`, so their cues are shifted by the server to match.
            <track key={s.key} kind="subtitles" src={offset > 0 ? withParam(s.url, 'offset', offset.toFixed(3)) : s.url} label={s.label} srcLang={s.language ?? undefined} />
          ))}
        </video>
      )}

      <SubtitleOverlay video={activeTrack?.video ?? null} track={activeTrack?.track ?? null} delay={subDelay} prefs={prefs} controlsVisible={showUi} />

      {(buffering || !streamSrc) && !error && (
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
              <button type="button" onClick={() => { setEnded(false); if (live && offset > 0) restartAt(0); else { const v = videoRef.current; if (v) { v.currentTime = 0; void v.play(); } } }} className="flex h-10 items-center gap-2 rounded-lg bg-raised px-4">
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
        {info?.decision.note && (
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-ink/80 sm:inline-flex" title={info.decision.note}>
            <AudioLines className="size-3.5" /> Audio converted
          </span>
        )}
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
            setSeekHover({ x, t: totalDuration ? (x / r.width) * totalDuration : 0 });
          }}
          onMouseLeave={() => setSeekHover(null)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-all group-hover:h-1.5">
            {live && offset > 0 && totalDuration > 0 && (
              <div className="absolute inset-y-0 bg-white/30" style={{ left: `${(offset / totalDuration) * 100}%`, width: `${Math.max(0, ((buffered - offset) / totalDuration) * 100)}%` }} />
            )}
            {!(live && offset > 0) && <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${totalDuration ? (buffered / totalDuration) * 100 : 0}%` }} />}
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${totalDuration ? Math.min(100, (time / totalDuration) * 100) : 0}%` }} />
          </div>
          {seekHover && totalDuration > 0 && (
            <span className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums" style={{ left: seekHover.x }}>
              {formatClock(seekHover.t)}
            </span>
          )}
          <input
            type="range"
            className="seek absolute inset-0 h-full w-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            min={0}
            max={totalDuration || 0}
            step={0.1}
            value={Math.min(time, totalDuration || 0)}
            aria-label="Seek"
            aria-valuetext={formatClock(time)}
            onChange={(e) => {
              const t = Number(e.target.value);
              setTime(t);
              seekTo(t);
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
            {formatClock(time)} <span className="text-ink/40">/ {formatClock(totalDuration)}</span>
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
            {fileAudio.length > 0 && (
              <button type="button" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} className="grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Audio">
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
              <div className="absolute right-0 bottom-14 max-h-[75vh] w-72 overflow-y-auto rounded-xl border border-line bg-surface/95 py-2 shadow-2xl backdrop-blur" role="menu">
                {menu === 'subs' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">Subtitles</p>
                    <MenuItem active={subKey === null} onClick={() => chooseSubtitle(null)}>Off</MenuItem>
                    {subs.map((s) => (
                      <MenuItem key={s.key} active={subKey === s.key} onClick={() => chooseSubtitle(s.key)}>
                        {s.label}
                        <span className="ml-2 text-xs text-faint">{s.kind === 'embedded' ? 'embedded' : 'file'}</span>
                      </MenuItem>
                    ))}
                    {subs.length === 0 && <p className="px-4 py-2 text-sm text-muted">No text subtitles found for this file.</p>}
                    {(file?.embeddedSubtitles.some((s) => !s.textBased) ?? false) && (
                      <p className="px-4 pt-2 text-xs text-faint">Image-based subtitles (PGS/VobSub) need transcoding and are not available yet.</p>
                    )}
                    <div className="mt-2 space-y-3 border-t border-line/60 px-4 pt-3 pb-1">
                      <Segmented label="Size" value={prefs.subtitleSize} onChange={(v) => setPrefs({ subtitleSize: v })} options={[['small', 'S'], ['medium', 'M'], ['large', 'L'], ['xlarge', 'XL']]} />
                      <Segmented label="Color" value={prefs.subtitleColor} onChange={(v) => setPrefs({ subtitleColor: v })} options={[['white', 'White'], ['yellow', 'Yellow']]} />
                      <Segmented label="Background" value={prefs.subtitleBackground} onChange={(v) => setPrefs({ subtitleBackground: v })} options={[['none', 'None'], ['translucent', 'Dim'], ['solid', 'Solid']]} />
                      <Segmented label="Edge" value={prefs.subtitleEdge} onChange={(v) => setPrefs({ subtitleEdge: v })} options={[['shadow', 'Shadow'], ['outline', 'Outline'], ['none', 'None']]} />
                      <Stepper
                        label="Position"
                        value={prefs.subtitlePosition === 0 ? 'Bottom' : `+${prefs.subtitlePosition}%`}
                        onMinus={() => setPrefs({ subtitlePosition: Math.max(0, prefs.subtitlePosition - 5) })}
                        onPlus={() => setPrefs({ subtitlePosition: Math.min(20, prefs.subtitlePosition + 5) })}
                      />
                      <Stepper
                        label="Sync"
                        value={subDelay === 0 ? 'In sync' : `${subDelay > 0 ? '+' : ''}${subDelay.toFixed(1)} s`}
                        hint="+ shows subtitles later"
                        onMinus={() => setSubDelay((d) => Math.round((d - 0.5) * 10) / 10)}
                        onPlus={() => setSubDelay((d) => Math.round((d + 0.5) * 10) / 10)}
                        onReset={subDelay !== 0 ? () => setSubDelay(0) : undefined}
                      />
                    </div>
                  </>
                )}
                {menu === 'audio' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">Audio track</p>
                    {canSwitchAudio && !live
                      ? audioTracks.map((t, i) => (
                          <MenuItem key={t.id || i} active={t.enabled} onClick={() => { selectNativeAudio(t.id); setMenu(null); }}>
                            {t.label || fileAudio[i]?.title || fileAudio[i]?.languageName || t.language || `Track ${i + 1}`}
                          </MenuItem>
                        ))
                      : fileAudio.map((a) => (
                          <MenuItem key={a.index} active={info?.decision.audioIndex === a.index} onClick={() => { selectServerAudio(a.index); setMenu(null); }}>
                            {a.title || a.languageName || 'Unknown'}
                            <span className="ml-2 text-xs text-faint">{[codecName(a.codec), channelLabel(a.channels)].filter(Boolean).join(' ')}</span>
                          </MenuItem>
                        ))}
                    <div className="mt-2 space-y-3 border-t border-line/60 px-4 pt-3 pb-1">
                      <Segmented label="Sound" value={prefs.audioOutput} onChange={(v) => changeAudioPrefs({ audioOutput: v })} options={[['stereo', 'Stereo'], ['surround', 'Surround 5.1']]} />
                      <Toggle label="Boost voices" checked={prefs.boostVoices} onChange={(v) => changeAudioPrefs({ boostVoices: v })} />
                      <Toggle label="Level volume" hint="Quieter explosions, louder dialogue" checked={prefs.levelVolume} onChange={(v) => changeAudioPrefs({ levelVolume: v })} />
                    </div>
                    {info?.decision.note && <p className="px-4 pt-2 text-xs text-faint">{info.decision.note}</p>}
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

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="pb-1 text-xs text-faint">{label}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`flex-1 rounded-md px-1 py-1 text-xs ${value === v ? 'bg-accent font-semibold text-accent-ink' : 'bg-raised hover:bg-line'}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({ label, value, hint, onMinus, onPlus, onReset }: { label: string; value: string; hint?: string; onMinus: () => void; onPlus: () => void; onReset?: () => void }) {
  return (
    <div>
      <p className="pb-1 text-xs text-faint">
        {label}
        {hint && <span className="ml-1 text-faint/70">({hint})</span>}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onMinus} className="grid size-7 place-items-center rounded-md bg-raised text-sm hover:bg-line" aria-label={`${label} down`}>−</button>
        <span className="flex-1 text-center text-xs tabular-nums">{value}</span>
        <button type="button" onClick={onPlus} className="grid size-7 place-items-center rounded-md bg-raised text-sm hover:bg-line" aria-label={`${label} up`}>+</button>
        {onReset && (
          <button type="button" onClick={onReset} className="ml-1 rounded-md px-2 py-1 text-xs text-muted hover:text-ink">Reset</button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 text-left text-sm">
      <span>
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-ink transition ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
