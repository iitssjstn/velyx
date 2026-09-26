import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Check,
  Keyboard,
  Maximize,
  Maximize2,
  Minimize,
  PictureInPicture2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipForward,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { detectCapabilities } from '../lib/codecs';
import { channelLabel, codecName, episodeCode, formatClock, imageUrl } from '../lib/format';
import { getPrefs, normalizeLanguage, sameLanguage, setPrefs, usePrefs, type PlaybackPrefs } from '../lib/prefs';
import { creditsPlaying, initialSubtitle, isTyping, preferredAudioIndex, skipAt, startPosition, subtitleName, upNextStart, withParam, type EpisodeSegments, type LanguagePreferences, type SkipAction } from '../lib/player';
import type { EpisodeDetail, MediaFileInfo, MovieDetail, PlaybackInfo, SubtitleOption } from '../lib/types';
import { defaultOnlineLanguage } from '../lib/online-subtitles';
import { OnlineSubtitles } from '../components/OnlineSubtitles';
import { toast } from '../components/Toast';
import { Spinner } from '../components/States';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { PlaybackBadge, PlaybackUnavailable } from '../components/PlaybackDetails';
import { UpNext } from '../components/UpNext';
import { currentLanguage, intlLocale, languageLabel, t, useT, type MessageKey } from '../i18n';

const SAVE_INTERVAL_MS = 10_000;
const HIDE_CONTROLS_MS = 3000;
const STALL_HINT_MS = 20_000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SHORTCUTS: Array<[string, MessageKey]> = [
  ['Space / K', 'player.shortcuts.playPause'],
  ['← / J', 'player.shortcuts.back'],
  ['→ / L', 'player.shortcuts.forward'],
  ['↑ / ↓', 'player.shortcuts.volume'],
  ['M', 'player.shortcuts.mute'],
  ['F', 'player.shortcuts.fullscreen'],
  ['I', 'player.shortcuts.minimize'],
  ['C', 'player.shortcuts.nextSubtitle'],
  ['S', 'player.shortcuts.skip'],
  ['N', 'player.shortcuts.nextEpisode'],
  ['0–9', 'player.shortcuts.jump'],
  ['?', 'player.shortcuts.help'],
  ['Esc', 'player.shortcuts.escape'],
];
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
  segments: EpisodeSegments | null;
}

async function loadItem(kind: string, id: number): Promise<LoadedItem> {
  if (kind === 'movie') {
    const m = await api.get<MovieDetail>(`/api/movies/${id}`);
    return { kind: 'movie', id, title: m.title, subtitle: m.year ? String(m.year) : null, backHref: `/movies/${id}`, backdrop: m.backdropPath, files: m.files, progress: m.progress, next: null, segments: null };
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
    segments: e.segments ?? null,
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

export interface PlayerProps {
  kind: 'movie' | 'episode';
  id: number;
  /** Query string the item was started with (?t=, ?file=). */
  search: string;
  /** Shown as a small floating player while the user browses Velyx. */
  mini: boolean;
  onMinimize: (backHref: string | undefined) => void;
  onRestore: () => void;
  onClose: (backHref: string | undefined) => void;
  /** Plays another item in this same player (next episode). */
  onPlayItem: (kind: 'movie' | 'episode', id: number) => void;
}

/**
 * The video player. One instance (and one <video> element) is kept alive by PlayerHost while an
 * item plays; minimizing only changes the layout, so the stream, position and tracks carry on.
 */
export default function Player({ kind, id, search, mini, onMinimize, onRestore, onClose, onPlayItem }: PlayerProps) {
  // Re-renders the player (never remounts it) when the interface language changes.
  useT();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const qc = useQueryClient();
  const prefs = usePrefs();

  const item = useQuery({ queryKey: ['play-item', kind, id], queryFn: () => loadItem(kind, id), gcTime: 0, staleTime: Infinity });
  // Account-wide language preferences; this browser's older local preferences fill any gaps.
  const accountPrefs = useQuery({ queryKey: ['account-prefs'], queryFn: () => api.get<LanguagePreferences>('/api/account/preferences'), staleTime: 5 * 60_000 });
  const langPrefs = useRef<LanguagePreferences>({ audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' });
  if (accountPrefs.data) langPrefs.current = accountPrefs.data;
  const prefsReady = !accountPrefs.isLoading;
  const fileParam = Number(params.get('file'));
  const file = item.data?.files.find((f) => f.id === fileParam) ?? item.data?.files[0];

  // Audio track to ask the server for. null = not decided yet, undefined = the file's default.
  const [audioChoice, setAudioChoice] = useState<number | undefined | null>(null);
  useEffect(() => {
    if (file && audioChoice === null && prefsReady) setAudioChoice(preferredAudioIndex(file.audioTracks, langPrefs.current.audioLanguage || getPrefs().audioLanguage, NATIVE_AUDIO_SWITCHING));
  }, [file, audioChoice, prefsReady]);

  const audioPrefs = { audioChannels: prefs.audioOutput, boostVoices: prefs.boostVoices, levelVolume: prefs.levelVolume };
  const playbackKey = ['playback', file?.id, audioChoice, audioPrefs.audioChannels, audioPrefs.boostVoices, audioPrefs.levelVolume];
  const playback = useQuery({
    queryKey: playbackKey,
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
  const [menu, setMenu] = useState<null | 'subs' | 'audio' | 'settings'>(null);
  const [subKey, setSubKey] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** The file is gone (removed or unmounted): trying again will not help. */
  const [errorGone, setErrorGone] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  // The server predicted the file cannot play here; the viewer can still try (browsers under-report).
  const [tryAnyway, setTryAnyway] = useState(false);
  // The browser reported a decoding error while playing.
  const [decodeFailed, setDecodeFailed] = useState(false);
  // Bumped by "Try again" to load the same stream URL into a fresh video element.
  const [reloadKey, setReloadKey] = useState(0);
  // Buffering for a long time without progress: offer a retry instead of an endless spinner.
  const [stalled, setStalled] = useState(false);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // The viewer closed the "Up next" card for this episode.
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Parts skipped automatically in this playback (each only once, so seeking back replays them),
  // and the short "Skipped" notice with a way back.
  const autoSkipped = useRef(new Set<string>());
  const [skipNotice, setSkipNotice] = useState<{ kind: 'intro' | 'credits'; back: number } | null>(null);
  const [audioTracks, setAudioTracks] = useState<BrowserAudioTrack[]>([]);
  const [seekHover, setSeekHover] = useState<{ x: number; w: number; t: number } | null>(null);
  // The stream to load: `base` is the decision's URL. Live (restart) streams are requested with
  // &start=`seek` and really begin at `offset` seconds into the file (the keyframe FFmpeg lands on).
  const [stream, setStream] = useState<{ base: string; offset: number; seek: number } | null>(null);
  const startedRef = useRef(false);
  const lastSaveRef = useRef(0);
  const lastTickRef = useRef(-1);
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
  // Where to start: ?t= when the viewer already chose (Resume / From start buttons), otherwise the
  // saved position — and then the viewer is asked first (resume or start over).
  const [startChoice, setStartChoice] = useState<number | null>(null);
  const suggestedStart = useMemo(() => startPosition(params.get('t'), item.data?.progress), [params, item.data?.progress]);
  const askResume = params.get('t') === null && suggestedStart > 0 && startChoice === null && !startedRef.current;
  const start = startChoice ?? suggestedStart;
  const totalDuration = live ? (info?.decision.durationSec ?? file?.durationSec ?? 0) : duration;
  const streamSrc = current ? (live && current.seek > 0 ? withParam(current.base, 'start', current.seek.toFixed(3)) : current.base) : null;

  /** Current position in the file (not in the current stream). */
  const currentTime = useCallback(() => offset + (videoRef.current?.currentTime ?? 0), [offset]);

  // ---------------------------------------------------------------- stream (re)initialisation
  // Decide where the stream starts whenever a new playback decision arrives (first load or audio switch).
  useEffect(() => {
    if (!info || askResume) return;
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
  }, [info, start, askResume]);

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
      // Live (converted) streams are not seekable for the browser (seekable = [0, 0]): setting
      // currentTime makes it silently reload the stream from its start. Every seek therefore asks the
      // server for a new stream that begins at the keyframe before `t`.
      if (live) restartAt(t);
      else v.currentTime = t;
    },
    [live, totalDuration, restartAt],
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

  // A subtitle fetched online joins the file's subtitles and is selected once its track exists.
  const pendingSubtitle = useRef<string | null>(null);
  const addSubtitle = useCallback(
    (option: SubtitleOption) => {
      qc.setQueryData<PlaybackInfo>(playbackKey, (old) => (old && !old.subtitles.some((s) => s.key === option.key) ? { ...old, subtitles: [...old.subtitles, option] } : old));
      pendingSubtitle.current = option.key;
      if (subs.some((s) => s.key === option.key)) {
        pendingSubtitle.current = null;
        chooseSubtitle(option.key);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, subs, chooseSubtitle, ...playbackKey],
  );
  useEffect(() => {
    const key = pendingSubtitle.current;
    if (key && subs.some((s) => s.key === key)) {
      pendingSubtitle.current = null;
      chooseSubtitle(key);
    }
  }, [subs, chooseSubtitle]);
  const removeSubtitle = useMutation({
    mutationFn: (option: SubtitleOption) => api.del(`/api/online-subtitles/${option.url.match(/(\d+)\.vtt$/)?.[1]}`),
    onSuccess: (_r, option) => {
      if (subKeyRef.current === option.key) chooseSubtitle(null);
      qc.setQueryData<PlaybackInfo>(playbackKey, (old) => (old ? { ...old, subtitles: old.subtitles.filter((s) => s.key !== option.key) } : old));
      void qc.invalidateQueries({ queryKey: ['online-subtitles', file?.id] });
      toast.success(t('onlineSubs.removed'));
    },
    onError: (err) => toast.error(err),
  });

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
    onPlayItem('episode', next.id);
  }, [onPlayItem, next]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose(item.data?.backHref);
  }, [onClose, item.data]);

  const minimize = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setMenu(null);
    onMinimize(item.data?.backHref);
  }, [onMinimize, item.data]);

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
    setUpNextDismissed(false);
    setStartChoice(null);
    setShowHelp(false);
    autoSkipped.current.clear();
    setSkipNotice(null);
    setError(null);
    setErrorGone(false);
    setStalled(false);
    setWarningDismissed(false);
    setTryAnyway(false);
    setDecodeFailed(false);
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
    // Direct play: jump to the resume/seek position. Live streams already begin at the keyframe
    // just before it; seeking inside them would make the browser reload the stream from its start.
    if (pending !== null && !live) {
      const local = pending - offset;
      if (local > 0.05 && local < v.duration - 1) v.currentTime = local;
    }
    if (!startedRef.current) {
      startedRef.current = true;
      const p = getPrefs();
      const playingAudio = file?.audioTracks.find((t) => t.index === info?.decision.audioIndex)?.language ?? null;
      selectSubtitle(initialSubtitle(subs, langPrefs.current, { language: p.subtitleLanguage, forced: p.subtitleForced, label: p.subtitleLabel }, playingAudio));
      // Preferred audio language in browsers that switch tracks natively (direct play only).
      const list = (v as unknown as { audioTracks?: AudioTrackList }).audioTracks;
      if (!live && list && list.length > 0) {
        const pref = langPrefs.current.audioLanguage || getPrefs().audioLanguage;
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
    // The picture is moving, so nothing is loading. Some browsers (notably with live remux
    // streams) fire "waiting" but never a matching "playing", which left the spinner up.
    if (!v.paused && v.currentTime !== lastTickRef.current) setBuffering(false);
    lastTickRef.current = v.currentTime;
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
    if (next && getPrefs().autoplayNext && !upNextDismissed) setCountdown((c) => c ?? getPrefs().autoplayCountdown);
  };

  const onError = async () => {
    const v = videoRef.current;
    const code = v?.error?.code;
    const reasons = info?.decision.reasons ?? [];
    setBuffering(false);
    if (code === 4 || code === 3) {
      // Browsers also report a failed HTTP request (connection lost, file removed, drive unmounted)
      // as "format not supported". Rule those out before blaming the format.
      const reachable = streamSrc ? await fetch(streamSrc, { method: 'HEAD', credentials: 'same-origin' }).then(() => true, () => false) : true;
      const gone = reachable
        ? await api.get(`/api/media/${file?.id}/available`).then(
            () => null,
            (err: unknown) => (err instanceof ApiError && err.status === 404 ? errorMessage(err) : null),
          )
        : null;
      // A stream that already played was understood by the browser: a later "not supported" is a transfer problem.
      if (!reachable || (code === 4 && startedRef.current && !gone)) setError(t('player.errors.interrupted'));
      else if (gone) {
        setError(gone);
        setErrorGone(true);
      } else if (info?.analysis) setDecodeFailed(true);
      else setError(reasons.length ? t('player.errors.cannotPlay', { reasons: reasons.join('; ') }) : t('player.errors.cannotDecode'));
    } else if (code === 2) {
      setError(t('player.errors.interrupted'));
    } else {
      setError(t('player.errors.failed'));
    }
  };

  /** Loads the stream again from where playback stopped (after a network error or a stall). */
  const retry = useCallback(() => {
    const at = time;
    setError(null);
    setErrorGone(false);
    setStalled(false);
    setBuffering(true);
    playAfterLoadRef.current = true;
    if (live) restartAt(at);
    else {
      pendingSeekRef.current = at > 0 ? at : null;
      setReloadKey((k) => k + 1);
    }
  }, [time, live, restartAt]);

  useEffect(() => {
    if (!buffering || error || ended) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_HINT_MS);
    return () => clearTimeout(t);
  }, [buffering, error, ended, streamSrc]);

  // ---------------------------------------------------------------- "Up next" near the end
  // Shown in the last seconds of an episode (long enough for the autoplay countdown), not earlier.
  // With detected credits (and nothing after them) it already appears when the credits begin.
  const upNextAt = next ? upNextStart(item.data?.segments, file?.id, totalDuration, prefs.autoplayCountdown) : null;
  const nearEnd = upNextAt !== null && time >= upNextAt;
  const showUpNext = Boolean(next) && !mini && !error && (ended || (nearEnd && !upNextDismissed));
  useEffect(() => {
    if (ended) return;
    if (nearEnd && !upNextDismissed && next && getPrefs().autoplayNext) setCountdown((c) => c ?? getPrefs().autoplayCountdown);
    // Seeking back out of the last seconds cancels a running countdown.
    if (!nearEnd) setCountdown(null);
  }, [nearEnd, upNextDismissed, next, ended]);

  // ---------------------------------------------------------------- skip intro / credits
  const skipModes = { intro: accountPrefs.data?.skipIntro ?? 'ask', credits: accountPrefs.data?.skipCredits ?? 'ask' };
  const skip = streamSrc && !askResume && !error ? skipAt(item.data?.segments, file?.id, time, skipModes) : null;
  const doSkip = useCallback(
    (s: SkipAction, automatic: boolean) => {
      // Always skipping credits that end the episode: straight on to the next one when autoplay is on.
      if (automatic && s.kind === 'credits' && s.toNext && next && getPrefs().autoplayNext) {
        goNext();
        return;
      }
      if (automatic) setSkipNotice({ kind: s.kind, back: time });
      seekTo(s.to);
    },
    [next, goNext, seekTo, time],
  );
  useEffect(() => {
    if (!skip || skip.mode !== 'always' || autoSkipped.current.has(skip.kind)) return;
    autoSkipped.current.add(skip.kind);
    doSkip(skip, true);
  }, [skip, doSkip]);
  useEffect(() => {
    if (!skipNotice) return;
    const t = setTimeout(() => setSkipNotice(null), 5000);
    return () => clearTimeout(t);
  }, [skipNotice]);

  // ---------------------------------------------------------------- auto-next countdown
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    // Paused before the end: the countdown waits too (it carries on when playback resumes).
    if (!playing && !ended) return;
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, goNext, playing, ended]);

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
    // While minimized the keyboard belongs to the page the user is browsing.
    if (mini) return;
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
        case 'i':
        case 'I':
          minimize();
          break;
        case '?':
          setShowHelp((h) => !h);
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
        case 's':
        case 'S':
          if (skip) doSkip(skip, false);
          break;
        case 'Escape':
          if (showHelp) setShowHelp(false);
          else if (menu) setMenu(null);
          else if (!document.fullscreenElement) exit();
          break;
        default:
          if (/^[0-9]$/.test(e.key) && totalDuration) seekTo((totalDuration * Number(e.key)) / 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mini, poke, togglePlay, seekBy, seekTo, applyVolume, toggleFullscreen, minimize, chooseSubtitle, goNext, exit, subs, subKey, next, menu, showHelp, volume, muted, totalDuration, skip, doSkip]);


  // ---------------------------------------------------------------- render
  const loadError = item.error ?? playback.error;
  if (loadError || (item.data && !file)) {
    return (
      <div className={mini ? MINI_CLASSES + ' items-center gap-3 px-3 text-sm sm:flex sm:aspect-auto sm:h-auto sm:p-4' : 'fixed inset-0 z-50 grid place-items-center bg-black px-6 text-center'}>
        {mini ? (
          <>
            <TriangleAlert className="size-5 shrink-0 text-amber" />
            <p className="min-w-0 flex-1 truncate">{loadError ? errorMessage(loadError) : t('player.noMediaFile')}</p>
            <button type="button" onClick={exit} className="grid size-9 place-items-center rounded-full hover:bg-white/10" aria-label={t('player.close')}><X className="size-4" /></button>
          </>
        ) : (
        <div>
          <TriangleAlert className="mx-auto size-10 text-amber" />
          <h1 className="mt-4 font-display text-2xl font-semibold">{t('player.cannotPlayItem')}</h1>
          <p className="mt-2 text-muted">{loadError ? errorMessage(loadError) : t('player.noMediaFileRescan')}</p>
          <button type="button" onClick={exit} className="mt-6 h-10 rounded-lg bg-raised px-4">{t('common.goBack')}</button>
        </div>
        )}
      </div>
    );
  }

  // Files that cannot play here are explained up front instead of failing (unless the viewer tries anyway).
  const blocked = Boolean(info && info.decision.mode === 'unsupported' && prefs.showCompatibilityWarnings && !tryAnyway);
  const showUnavailable = Boolean(info?.analysis && (blocked || decodeFailed));
  const showWarning = info && info.decision.compatible === false && prefs.showCompatibilityWarnings && !warningDismissed && !error && !showUnavailable;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const fileAudio = file?.audioTracks ?? [];
  const canSwitchAudio = audioTracks.length > 1;
  const showUi = controlsVisible || !playing || menu !== null;

  return (
    <div
      ref={wrapRef}
      className={mini ? `${MINI_CLASSES} select-none` : `fixed inset-0 z-50 bg-black text-ink select-none [--player-controls:10rem] ${showUi ? '' : 'cursor-none'}`}
      onMouseMove={mini ? undefined : poke}
      onTouchStart={mini ? undefined : poke}
      role={mini ? 'region' : undefined}
      aria-label={mini ? t('player.miniPlayer') : undefined}
    >
      {!mini && showUnavailable && info && (
        <PlaybackUnavailable
          analysis={
            decodeFailed && info.analysis.mode !== 'unsupported'
              ? {
                  ...info.analysis,
                  mode: 'unsupported',
                  components: { ...info.analysis.components, video: { status: 'fail', note: t('player.errors.decodeError') } },
                  summary: [t('player.errors.couldNotPlay'), t('player.errors.noTranscoding')],
                }
              : info.analysis
          }
          onBack={exit}
          onTryAnyway={blocked ? () => setTryAnyway(true) : undefined}
          onNext={next ? goNext : undefined}
        />
      )}

      {info && streamSrc && !blocked && (
        <video
          key={`${streamSrc}#${reloadKey}`}
          ref={videoRef}
          src={streamSrc}
          className={mini ? 'h-full w-28 shrink-0 cursor-pointer bg-black object-cover sm:w-full sm:object-contain' : 'h-full w-full'}
          preload="metadata"
          playsInline
          poster={imageUrl(item.data?.backdrop, 'w1280') ?? undefined}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={() => !live && setDuration(videoRef.current?.duration ?? 0)}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => {
            setPlaying(true);
            // Playing again after the end cancels the countdown; resuming from a pause continues it.
            if (ended) setCountdown(null);
            setEnded(false);
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
            if (mini) onRestore();
            else if (menu) setMenu(null);
            else togglePlay();
          }}
          onDoubleClick={mini ? undefined : toggleFullscreen}
        >
          {subs.map((s) => (
            // Live streams start at `offset`, so their cues are shifted by the server to match.
            <track key={s.key} kind="subtitles" src={offset > 0 ? withParam(s.url, 'offset', offset.toFixed(3)) : s.url} label={s.label} srcLang={s.language ?? undefined} />
          ))}
        </video>
      )}

      {/* The chosen subtitle stays selected while minimized; it is only not drawn on the small video. */}
      {!mini && <SubtitleOverlay video={activeTrack?.video ?? null} track={activeTrack?.track ?? null} delay={subDelay} prefs={prefs} controlsVisible={showUi} />}

      {!mini && !askResume && (buffering || !streamSrc) && !error && !showUnavailable && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4">
            <Spinner className="size-10" />
            {stalled && streamSrc && (
              <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl bg-black/70 px-5 py-4 text-center text-sm backdrop-blur" role="status">
                <p className="text-ink/85">{t('player.slow')}</p>
                <button type="button" onClick={retry} className="flex h-9 items-center gap-2 rounded-lg bg-raised px-4">
                  <RotateCcw className="size-4" /> {t('common.tryAgain')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!mini && error && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 px-6 text-center">
          <div className="max-w-lg">
            <TriangleAlert className="mx-auto size-10 text-amber" />
            <h2 className="mt-4 font-display text-2xl font-semibold">{t('player.problem')}</h2>
            <p className="mt-2 text-muted">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={exit} className="h-10 rounded-lg bg-raised px-4">{t('common.goBack')}</button>
              {!errorGone && (
                <button type="button" onClick={retry} className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-accent-ink">
                  <RotateCcw className="size-4" /> {t('common.tryAgain')}
                </button>
              )}
              {next && (
                <button type="button" onClick={goNext} className="h-10 rounded-lg bg-raised px-4">{t('player.nextEpisode')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {!mini && showWarning && (
        <div className="absolute top-20 left-1/2 z-10 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-amber/30 bg-black/80 px-4 py-3 text-sm backdrop-blur">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
          <p className="flex-1 text-ink/85">
            {t('player.mayNotPlay', { reasons: info!.decision.reasons.join('; ') })}
          </p>
          <button type="button" className="text-muted hover:text-ink" onClick={() => setWarningDismissed(true)}>{t('common.dismiss')}</button>
        </div>
      )}

      {/* Skip intro / credits: bottom right, clear of centred subtitles; shown while the part plays. */}
      {!mini && skip && skip.mode === 'ask' && !showUpNext && !showUnavailable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            doSkip(skip, false);
          }}
          className="absolute right-4 bottom-40 z-20 sm:right-8 flex h-11 items-center gap-2 rounded-lg border border-white/25 bg-black/70 px-4 font-semibold backdrop-blur sm:h-14 sm:px-6 sm:text-lg transition hover:bg-white hover:text-black"
        >
          <SkipForward className="size-4" /> {skip.kind === 'intro' ? t('player.skipIntro') : t('player.skipCredits')}
        </button>
      )}
      {!mini && skipNotice && !showUpNext && (
        <div className="absolute right-4 bottom-40 z-20 sm:right-8 flex items-center gap-3 rounded-lg bg-black/70 px-4 py-2.5 text-sm backdrop-blur" role="status">
          <span>{skipNotice.kind === 'intro' ? t('player.introSkipped') : t('player.creditsSkipped')}</span>
          <button
            type="button"
            onClick={() => {
              autoSkipped.current.add('intro').add('credits');
              seekTo(skipNotice.back);
              setSkipNotice(null);
            }}
            className="font-semibold text-accent hover:underline"
          >
            {t('common.undo')}
          </button>
        </div>
      )}

      {/* Next episode: at the credits (or the last seconds), with Watch credits and a filling Next episode button. */}
      {showUpNext && next && (
        <UpNext
          next={next}
          countdown={countdown}
          countdownTotal={prefs.autoplayCountdown}
          credits={creditsPlaying(item.data?.segments, file?.id, time)}
          ended={ended}
          onPlay={goNext}
          onStay={() => {
            setCountdown(null);
            if (!ended) setUpNextDismissed(true);
          }}
        />
      )}
      {!mini && ended && !next && !error && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60">
          <div className="text-center">
            <p className="font-display text-2xl font-semibold">{t('player.finished')}</p>
            <div className="mt-4 flex justify-center gap-3">
              <button type="button" onClick={() => { setEnded(false); if (live && offset > 0) restartAt(0); else { const v = videoRef.current; if (v) { v.currentTime = 0; void v.play(); } } }} className="flex h-10 items-center gap-2 rounded-lg bg-raised px-4">
                <RotateCcw className="size-4" /> {t('player.watchAgain')}
              </button>
              <Link to={item.data?.backHref ?? '/'} className="flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">{t('common.done')}</Link>
            </div>
          </div>
        </div>
      )}

      {!mini && askResume && item.data && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 px-6" role="dialog" aria-label={t('player.resumePlayback')}>
          <div className="w-full max-w-xs rounded-2xl border border-line bg-surface/95 p-5 text-center shadow-2xl backdrop-blur">
            <p className="font-display text-lg font-semibold">{t('player.resumeFrom', { time: formatClock(suggestedStart) })}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" autoFocus onClick={() => setStartChoice(suggestedStart)} className="h-10 flex-1 rounded-lg bg-accent font-semibold text-accent-ink">{t('player.resume')}</button>
              <button type="button" onClick={() => setStartChoice(0)} className="h-10 flex-1 rounded-lg bg-raised">{t('player.startOver')}</button>
            </div>
          </div>
        </div>
      )}

      {!mini && showHelp && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 px-6" role="dialog" aria-label={t('player.keyboardShortcuts')} onClick={() => setShowHelp(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface/95 p-5 shadow-2xl backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-semibold">{t('player.keyboardShortcuts')}</p>
              <button type="button" onClick={() => setShowHelp(false)} className="grid size-8 place-items-center rounded-full hover:bg-raised" aria-label={t('common.close')}><X className="size-4" /></button>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {SHORTCUTS.map(([keys, action]) => (
                <div key={keys} className="contents">
                  <dt><kbd className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dt>
                  <dd className="text-ink/85">{t(action)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className={`absolute inset-x-0 top-0 items-center gap-3 ${mini ? 'hidden' : 'flex'} bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-12 transition-opacity duration-300 sm:px-8 sm:pt-6 sm:pb-16 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <button type="button" onClick={exit} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('common.back')}>
          <ArrowLeft className="size-5 sm:size-7" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold sm:text-2xl">{item.data?.title}</p>
          {item.data?.subtitle && <p className="truncate text-sm text-ink/70 sm:text-base">{item.data.subtitle}</p>}
        </div>
        {info?.analysis && (
          <PlaybackBadge
            analysis={info.analysis}
            subtitle={(() => {
              const active = subs.find((x) => x.key === subKey);
              return active ? `${subtitleName(active)} · ${active.kind === 'embedded' ? t('player.embedded') : active.kind === 'online' ? t('onlineSubs.tag') : t('player.file')}` : null;
            })()}
          />
        )}
      </div>

      {/* Bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 ${mini ? 'hidden' : ''} bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-4 transition-opacity duration-300 sm:px-8 sm:pt-24 sm:pb-7 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Seek bar */}
        <div
          className="group relative h-5 sm:h-7"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
            setSeekHover({ x, w: r.width, t: totalDuration ? (x / r.width) * totalDuration : 0 });
          }}
          onMouseLeave={() => setSeekHover(null)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-all group-hover:h-1.5 sm:h-1.5 sm:group-hover:h-2.5">
            {live && offset > 0 && totalDuration > 0 && (
              <div className="absolute inset-y-0 bg-white/30" style={{ left: `${(offset / totalDuration) * 100}%`, width: `${Math.max(0, ((buffered - offset) / totalDuration) * 100)}%` }} />
            )}
            {!(live && offset > 0) && <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${totalDuration ? (buffered / totalDuration) * 100 : 0}%` }} />}
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${totalDuration ? Math.min(100, (time / totalDuration) * 100) : 0}%` }} />
          </div>
          {seekHover && totalDuration > 0 && (
            <span className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums sm:-top-9 sm:px-2 sm:text-sm" style={{ left: Math.min(Math.max(seekHover.x, 24), seekHover.w - 24) }}>
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
            aria-label={t('player.seek')}
            aria-valuetext={formatClock(time)}
            onChange={(e) => {
              const to = Number(e.target.value);
              setTime(to);
              seekTo(to);
            }}
          />
        </div>

        {/* On phones the buttons on the right move to a second row, so every control fits on screen. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 sm:mt-3 sm:flex-nowrap sm:gap-3">
          <button type="button" onClick={togglePlay} className="grid size-11 place-items-center rounded-full hover:bg-white/10 sm:size-14" aria-label={playing ? t('player.pause') : t('player.play')}>
            {playing ? <Pause className="size-6 fill-current sm:size-9" /> : <Play className="size-6 fill-current sm:size-9" />}
          </button>
          <button type="button" onClick={() => seekBy(-10)} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('player.shortcuts.back')} title={t('player.backTitle')}>
            <RotateCcw className="size-5 sm:size-7" />
          </button>
          <button type="button" onClick={() => seekBy(10)} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('player.shortcuts.forward')} title={t('player.forwardTitle')}>
            <RotateCw className="size-5 sm:size-7" />
          </button>
          <div className="group/vol hidden items-center sm:flex">
            <button type="button" onClick={() => applyVolume(volume, !muted)} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={muted ? t('player.unmute') : t('player.shortcuts.mute')}>
              <VolumeIcon className="size-5 sm:size-7" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value), Number(e.target.value) === 0)}
              className="w-0 accent-[var(--color-accent)] opacity-0 transition-all group-hover/vol:w-24 group-hover/vol:opacity-100 focus-visible:w-24 sm:group-hover/vol:w-32 sm:focus-visible:w-32 focus-visible:opacity-100"
              aria-label={t('player.volume')}
            />
          </div>
          <span className="ml-1 text-sm whitespace-nowrap text-ink/80 tabular-nums sm:ml-3 sm:text-lg">
            {formatClock(time)} <span className="text-ink/40">/ {formatClock(totalDuration)}</span>
          </span>

          <div className="relative ml-auto flex shrink-0 items-center gap-1">
            {next && (
              <button type="button" onClick={goNext} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('player.nextEpisode')} title={t('player.nextEpisodeTitle')}>
                <SkipForward className="size-5 sm:size-7" />
              </button>
            )}
            <button type="button" onClick={() => setMenu(menu === 'subs' ? null : 'subs')} className={`grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12 ${subKey ? 'text-accent' : ''}`} aria-label={t('playback.subtitles')} title={t('player.subtitlesTitle')}>
              <Captions className="size-5 sm:size-7" />
            </button>
            {fileAudio.length > 0 && (
              <button type="button" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('playback.audio')}>
                <AudioLines className="size-5 sm:size-7" />
              </button>
            )}
            <button type="button" onClick={() => setMenu(menu === 'settings' ? null : 'settings')} className={`grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12 ${speed !== 1 ? 'text-accent' : ''}`} aria-label={t('player.settings')} title={t('player.settings')}>
              <Settings2 className="size-5 sm:size-7" />
            </button>
            <button type="button" onClick={minimize} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={t('player.shortcuts.minimize')} title={t('player.minimizeTitle')}>
              <PictureInPicture2 className="size-5 sm:size-7" />
            </button>
            <button type="button" onClick={toggleFullscreen} className="grid size-10 place-items-center rounded-full hover:bg-white/10 sm:size-12" aria-label={fullscreen ? t('player.exitFullscreen') : t('player.shortcuts.fullscreen')} title={t('player.fullscreenTitle')}>
              {fullscreen ? <Minimize className="size-5 sm:size-7" /> : <Maximize className="size-5 sm:size-7" />}
            </button>

            {menu && (
              <div className="absolute right-0 bottom-12 max-h-[min(75vh,calc(100dvh-7rem))] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto sm:bottom-16 rounded-xl border border-line bg-surface/95 py-2 shadow-2xl backdrop-blur" role="menu">
                {menu === 'subs' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">{t('playback.subtitles')}</p>
                    <MenuItem active={subKey === null} onClick={() => chooseSubtitle(null)}>{t('player.off')}</MenuItem>
                    {subs.map((s) => (
                      <div key={s.key} className="flex items-center">
                        <div className="min-w-0 flex-1">
                          <MenuItem active={subKey === s.key} onClick={() => chooseSubtitle(s.key)}>
                            {subtitleName(s)}
                            {s.forced && ` (${t('media.forced').toLowerCase()})`}
                            <span className="ml-2 text-xs text-faint">{s.kind === 'embedded' ? t('player.embedded') : s.kind === 'online' ? t('onlineSubs.tag') : t('player.file')}</span>
                          </MenuItem>
                        </div>
                        {s.kind === 'online' && s.removable && (
                          <button type="button" onClick={() => removeSubtitle.mutate(s)} className="mr-2 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-raised hover:text-ink" aria-label={t('onlineSubs.remove', { name: subtitleName(s) })} title={t('onlineSubs.remove', { name: subtitleName(s) })}>
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {subs.length === 0 && <p className="px-4 py-2 text-sm text-muted">{t('player.noSubtitles')}</p>}
                    {info?.onlineSubtitles && file && (
                      <OnlineSubtitles
                        fileId={file.id}
                        defaultLanguage={defaultOnlineLanguage(langPrefs.current.subtitleLanguage, langPrefs.current.subtitleFallback, getPrefs().subtitleLanguage, currentLanguage())}
                        activeKey={subKey}
                        onChosen={addSubtitle}
                      />
                    )}
                    {(file?.embeddedSubtitles.some((s) => !s.textBased) ?? false) && (
                      <p className="px-4 pt-2 text-xs text-faint">{t('player.imageSubtitles')}</p>
                    )}
                    <div className="mt-2 space-y-3 border-t border-line/60 px-4 pt-3 pb-1">
                      <Segmented label={t('subtitleStyle.size')} value={prefs.subtitleSize} onChange={(v) => setPrefs({ subtitleSize: v })} options={[['small', 'S'], ['medium', 'M'], ['large', 'L'], ['xlarge', 'XL']]} />
                      <Segmented label={t('subtitleStyle.color')} value={prefs.subtitleColor} onChange={(v) => setPrefs({ subtitleColor: v })} options={[['white', t('subtitleStyle.white')], ['yellow', t('subtitleStyle.yellow')]]} />
                      <Segmented label={t('subtitleStyle.background')} value={prefs.subtitleBackground} onChange={(v) => setPrefs({ subtitleBackground: v })} options={[['none', t('subtitleStyle.none')], ['translucent', t('player.dim')], ['solid', t('player.solid')]]} />
                      <Segmented label={t('subtitleStyle.edge')} value={prefs.subtitleEdge} onChange={(v) => setPrefs({ subtitleEdge: v })} options={[['shadow', t('player.shadow')], ['outline', t('subtitleStyle.outline')], ['none', t('subtitleStyle.none')]]} />
                      <Stepper
                        label={t('subtitleStyle.position')}
                        value={prefs.subtitlePosition === 0 ? t('subtitleStyle.bottom') : `+${prefs.subtitlePosition}%`}
                        onMinus={() => setPrefs({ subtitlePosition: Math.max(0, prefs.subtitlePosition - 5) })}
                        onPlus={() => setPrefs({ subtitlePosition: Math.min(20, prefs.subtitlePosition + 5) })}
                      />
                      <Stepper
                        label={t('player.sync')}
                        value={subDelay === 0 ? t('player.inSync') : `${subDelay > 0 ? '+' : ''}${subDelay.toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`}
                        hint={t('player.syncHint')}
                        onMinus={() => setSubDelay((d) => Math.round((d - 0.5) * 10) / 10)}
                        onPlus={() => setSubDelay((d) => Math.round((d + 0.5) * 10) / 10)}
                        onReset={subDelay !== 0 ? () => setSubDelay(0) : undefined}
                      />
                    </div>
                  </>
                )}
                {menu === 'audio' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">{t('player.audioTrack')}</p>
                    {canSwitchAudio && !live
                      ? audioTracks.map((track, i) => (
                          <MenuItem key={track.id || i} active={track.enabled} onClick={() => { selectNativeAudio(track.id); setMenu(null); }}>
                            {track.label || fileAudio[i]?.title || languageLabel(fileAudio[i]?.language ?? track.language) || fileAudio[i]?.languageName || track.language || t('player.track', { n: i + 1 })}
                          </MenuItem>
                        ))
                      : fileAudio.map((a) => (
                          <MenuItem key={a.index} active={info?.decision.audioIndex === a.index} onClick={() => { selectServerAudio(a.index); setMenu(null); }}>
                            {[languageLabel(a.language) || a.languageName || a.title || t('playback.unknown'), channelLabel(a.channels)].filter(Boolean).join(' ')}
                            <span className="ml-2 text-xs text-faint">{[a.title && a.title !== a.languageName ? a.title : null, codecName(a.codec)].filter(Boolean).join(' · ')}</span>
                          </MenuItem>
                        ))}
                    <div className="mt-2 space-y-3 border-t border-line/60 px-4 pt-3 pb-1">
                      <Segmented label={t('settings.audio.sound')} value={prefs.audioOutput} onChange={(v) => changeAudioPrefs({ audioOutput: v })} options={[['stereo', t('media.stereo')], ['surround', t('settings.audio.surround')]]} />
                      <Toggle label={t('settings.audio.boostVoices')} checked={prefs.boostVoices} onChange={(v) => changeAudioPrefs({ boostVoices: v })} />
                      <Toggle label={t('settings.audio.levelVolume')} hint={t('player.levelVolumeHint')} checked={prefs.levelVolume} onChange={(v) => changeAudioPrefs({ levelVolume: v })} />
                    </div>
                    {info?.decision.note && <p className="px-4 pt-2 text-xs text-faint">{info.decision.note}</p>}
                  </>
                )}
                {menu === 'settings' && (
                  <>
                    <p className="px-4 pt-1 pb-2 text-xs text-faint">{t('player.settings')}</p>
                    <div className="space-y-3 px-4 pb-2">
                      <Segmented
                        label={t('player.speed')}
                        value={String(speed)}
                        onChange={(v) => {
                          const n = Number(v);
                          setSpeed(n);
                          if (videoRef.current) videoRef.current.playbackRate = n;
                        }}
                        options={SPEEDS.map((n) => [String(n), `${n.toLocaleString(intlLocale())}×`] as [string, string])}
                      />
                      <Toggle label={t('settings.playback.autoplay')} checked={prefs.autoplayNext} onChange={(v) => setPrefs({ autoplayNext: v })} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(null);
                        setShowHelp(true);
                      }}
                      className="flex w-full items-center gap-3 border-t border-line/60 px-4 pt-3 pb-1 text-left text-sm hover:text-accent"
                    >
                      <Keyboard className="size-4 shrink-0" /> {t('player.keyboardShortcuts')}
                      <kbd className="ml-auto rounded bg-raised px-1.5 font-mono text-xs text-muted">?</kbd>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {mini && (
        <MiniBar
          title={item.data?.title ?? ''}
          subtitle={item.data?.subtitle ?? null}
          playing={playing}
          loading={buffering || !streamSrc}
          problem={error ?? (showUnavailable ? t('player.cannotPlayHere') : null)}
          progress={totalDuration ? Math.min(1, time / totalDuration) : 0}
          onTogglePlay={togglePlay}
          onRestore={onRestore}
          onClose={exit}
        />
      )}
    </div>
  );
}

/**
 * Floating player: bottom-right card on larger screens, a compact bar along the bottom edge on
 * phones. The <video> stays the same element as in the full player.
 */
const MINI_CLASSES =
  'fixed z-50 flex h-16 items-center overflow-hidden rounded-xl bg-black text-ink shadow-2xl ring-1 ring-white/10 inset-x-2 bottom-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:block sm:h-auto sm:w-[22rem] sm:aspect-video';

function MiniBar({ title, subtitle, playing, loading, problem, progress, onTogglePlay, onRestore, onClose }: {
  title: string;
  subtitle: string | null;
  playing: boolean;
  loading: boolean;
  problem: string | null;
  progress: number;
  onTogglePlay: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  useT();
  const button = 'grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 pr-1 pl-3 sm:absolute sm:inset-x-0 sm:bottom-0 sm:bg-gradient-to-t sm:from-black/90 sm:via-black/60 sm:to-transparent sm:px-2 sm:pt-8 sm:pb-2">
      <button type="button" onClick={onRestore} className="min-w-0 flex-1 text-left" title={t('player.openFull')}>
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className={`block truncate text-xs ${problem ? 'text-amber' : 'text-ink/70'}`}>{problem ?? subtitle ?? (loading ? t('common.loadingDots') : '\u00a0')}</span>
      </button>
      <button type="button" onClick={onTogglePlay} className={button} aria-label={playing ? t('player.pause') : t('player.play')}>
        {loading && !problem ? <Spinner className="size-4" /> : playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
      </button>
      <button type="button" onClick={onRestore} className={button} aria-label={t('player.openFull')} title={t('player.openFull')}>
        <Maximize2 className="size-4" />
      </button>
      <button type="button" onClick={onClose} className={button} aria-label={t('player.close')} title={t('player.stopAndClose')}>
        <X className="size-4" />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
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
        <button type="button" onClick={onMinus} className="grid size-7 place-items-center rounded-md bg-raised text-sm hover:bg-line" aria-label={t('player.decrease', { label })}>−</button>
        <span className="flex-1 text-center text-xs tabular-nums">{value}</span>
        <button type="button" onClick={onPlus} className="grid size-7 place-items-center rounded-md bg-raised text-sm hover:bg-line" aria-label={t('player.increase', { label })}>+</button>
        {onReset && (
          <button type="button" onClick={onReset} className="ml-1 rounded-md px-2 py-1 text-xs text-muted hover:text-ink">{t('browse.reset')}</button>
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
