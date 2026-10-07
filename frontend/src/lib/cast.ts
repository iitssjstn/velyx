import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PlaybackPrefs } from './prefs';

export type CastSubtitleStyle = Pick<PlaybackPrefs, 'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitleEdge'>;

export function castTextTrackStyle(style?: CastSubtitleStyle) {
  const current = style ?? { subtitleSize: 'medium', subtitleColor: 'white', subtitleBackground: 'none', subtitleEdge: 'shadow' };
  return {
    fontFamily: 'sans-serif',
    fontGenericFamily: 'SANS_SERIF',
    fontScale: { small: 0.8, medium: 1, large: 1.2, xlarge: 1.4 }[current.subtitleSize],
    foregroundColor: current.subtitleColor === 'yellow' ? '#FFE14DFF' : '#FFFFFFFF',
    backgroundColor: { none: '#00000000', translucent: '#00000099', solid: '#000000EB' }[current.subtitleBackground],
    edgeType: { shadow: 'DROP_SHADOW', outline: 'OUTLINE', none: 'NONE' }[current.subtitleEdge],
    edgeColor: '#000000FF',
  };
}

/**
 * Casting to a Chromecast (or a TV with Chromecast built in) from the browser, with Google's Cast
 * SDK (Chrome only; other browsers simply show no cast button). The Chromecast fetches the video
 * itself, with a short-lived token for just this file; this page becomes its remote control.
 */

export interface CastSubtitle {
  key: string;
  label: string;
  language: string | null;
  url: string;
}

export interface CastSession {
  token: string;
  relayUrl: string | null;
  serverUrl: string | null;
  expiresAt: number;
  contentType: string;
  decision: { engine: string; streamUrl: string; seek: 'range' | 'restart'; durationSec: number | null; optimized?: { id: number; profile: 'compat-720p' | 'compat-1080p' } };
  subtitles: CastSubtitle[];
}

/**
 * The address the Chromecast uses for this server: the page's own; on app.vidalune.com (which only
 * works with the browser's sign-in) the server's relay address; on "localhost" (the Chromecast is
 * another device) the address set under Admin → Server.
 */
export function castBase(origin: string, s: Pick<CastSession, 'relayUrl' | 'serverUrl'>): string {
  const host = new URL(origin).hostname;
  const trim = (u: string) => u.replace(/\/+$/, '');
  if (host.startsWith('app.') && s.relayUrl) return trim(s.relayUrl);
  if ((host === 'localhost' || host === '127.0.0.1' || host === '::1') && s.serverUrl) return trim(s.serverUrl);
  return trim(origin);
}

/** An address for the Chromecast: absolute, with the cast token (and a start for repackaged streams). */
export function castUrl(base: string, path: string, token: string, start?: number): string {
  const u = new URL(path, `${base}/`);
  if (start && start > 0) u.searchParams.set('start', start.toFixed(3));
  u.searchParams.set('cast', token);
  return u.toString();
}

// ---- Google's Cast SDK (typed as little as needed)

/* eslint-disable @typescript-eslint/no-explicit-any */
type CastWindow = Window & { cast?: any; chrome?: any; __onGCastApiAvailable?: (ok: boolean) => void };
const w = (typeof window === 'undefined' ? {} : window) as CastWindow;
const SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
let sdk: Promise<any | null> | null = null;

/** Loads the SDK once (Chrome only); null where casting is not available. */
export function loadCastSdk(): Promise<any | null> {
  if (sdk) return sdk;
  sdk = new Promise((resolve) => {
    // Only Chromium browsers can cast; elsewhere the SDK is not even loaded.
    if (typeof document === 'undefined' || !w.chrome) return resolve(null);
    const timer = setTimeout(() => resolve(null), 15_000);
    w.__onGCastApiAvailable = (ok) => {
      clearTimeout(timer);
      if (!ok || !w.cast?.framework) return resolve(null);
      const context = w.cast.framework.CastContext.getInstance();
      context.setOptions({ receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      resolve(w.cast.framework);
    };
    const s = document.createElement('script');
    s.src = SDK;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.append(s);
  });
  return sdk;
}

export interface CastItem {
  fileId: number;
  audioIndex: number | null;
  optimizationId?: number;
  title: string;
  subtitle?: string | null;
  posterPath?: string | null;
  /** The chosen subtitle (its key), shown on the TV too. */
  subtitleKey: string | null;
  subtitleStyle?: CastSubtitleStyle;
  /** Keyframe before a position, for repackaged streams (they start at a keyframe). */
  locate: (target: number) => Promise<{ offset: number; seek: number }>;
}

export interface CastState {
  /** A Chromecast is around (the button shows). */
  available: boolean;
  /** Playing on a Chromecast now. */
  active: boolean;
  device: string | null;
  /** Position in the file (seconds). */
  time: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
}

/**
 * The player's side of casting: start (the TV continues where the page was), play/pause, seek
 * (a repackaged stream is loaded again from the new spot), and the position while it plays.
 */
export function useCast(item: CastItem | null) {
  const [state, setState] = useState<CastState>({ available: false, active: false, device: null, time: 0, playing: false, volume: 1, muted: false, error: null });
  const framework = useRef<any>(null);
  const player = useRef<any>(null);
  const controller = useRef<any>(null);
  const session = useRef<CastSession | null>(null);
  const offset = useRef(0);
  const itemRef = useRef(item);
  itemRef.current = item;

  useEffect(() => {
    let alive = true;
    void loadCastSdk().then((f) => {
      if (!alive || !f) return;
      framework.current = f;
      const context = f.CastContext.getInstance();
      const update = () => {
        const s = context.getCastState();
        setState((st) => ({ ...st, available: s !== f.CastState.NO_DEVICES_AVAILABLE }));
      };
      context.addEventListener(f.CastContextEventType.CAST_STATE_CHANGED, update);
      update();
      player.current = new f.RemotePlayer();
      controller.current = new f.RemotePlayerController(player.current);
      const c = controller.current;
      c.addEventListener(f.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => setState((st) => ({ ...st, time: offset.current + (player.current.currentTime ?? 0) })));
      c.addEventListener(f.RemotePlayerEventType.IS_PAUSED_CHANGED, () => setState((st) => ({ ...st, playing: !player.current.isPaused })));
      c.addEventListener(f.RemotePlayerEventType.VOLUME_LEVEL_CHANGED, () => setState((st) => ({ ...st, volume: player.current.volumeLevel ?? st.volume })));
      c.addEventListener(f.RemotePlayerEventType.IS_MUTED_CHANGED, () => setState((st) => ({ ...st, muted: Boolean(player.current.isMuted) })));
      c.addEventListener(f.RemotePlayerEventType.IS_CONNECTED_CHANGED, () => {
        if (!player.current.isConnected) setState((st) => ({ ...st, active: false, device: null }));
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Loads the file on the Chromecast from `at` (seconds in the file). */
  const load = useCallback(
    async (at: number, audioOverride?: number | null) => {
      const it = itemRef.current;
      const f = framework.current;
      const castSession = f?.CastContext.getInstance().getCurrentSession();
      if (!it || !castSession) return;
      const chromeCast = w.chrome.cast;
      const audioIndex = audioOverride === undefined ? it.audioIndex : audioOverride;
      if (!session.current || session.current.expiresAt < Date.now() + 60_000 || audioOverride !== undefined) session.current = await api.post<CastSession>('/api/cast/session', { fileId: it.fileId, ...(audioIndex !== null ? { audioIndex } : {}), ...(it.optimizationId ? { optimizationId: it.optimizationId } : {}) });
      const s = session.current;
      const base = castBase(window.location.origin, s);
      let start = 0;
      let startTime = at;
      if (s.decision.seek === 'restart' && at > 0) {
        const k = await it.locate(at);
        start = k.seek;
        offset.current = k.offset;
        startTime = Math.max(0, at - k.offset);
      } else offset.current = 0;
      const media = new chromeCast.media.MediaInfo(castUrl(base, s.decision.streamUrl, s.token, start), s.contentType);
      media.streamType = chromeCast.media.StreamType.BUFFERED;
      media.textTrackStyle = Object.assign(new chromeCast.media.TextTrackStyle(), castTextTrackStyle(it.subtitleStyle));
      const meta = new chromeCast.media.GenericMediaMetadata();
      meta.title = it.title;
      if (it.subtitle) meta.subtitle = it.subtitle;
      if (it.posterPath) meta.images = [new chromeCast.Image(castUrl(base, `/api/images/w342/${it.posterPath.replace(/^\//, '')}`, s.token))];
      media.metadata = meta;
      media.duration = s.decision.durationSec ?? undefined;
      media.tracks = s.subtitles.map((sub, i) => {
        const track = new chromeCast.media.Track(i + 1, chromeCast.media.TrackType.TEXT);
        // The same clock as the stream (a repackaged one counts from its start).
        const path = offset.current > 0 ? `${sub.url}${sub.url.includes('?') ? '&' : '?'}offset=${offset.current.toFixed(3)}` : sub.url;
        track.trackContentId = castUrl(base, path, s.token);
        track.trackContentType = 'text/vtt';
        track.subtype = chromeCast.media.TextTrackType.SUBTITLES;
        track.name = sub.label;
        if (sub.language) track.language = sub.language;
        return track;
      });
      const request = new chromeCast.media.LoadRequest(media);
      request.currentTime = startTime;
      request.autoplay = true;
      const chosen = s.subtitles.findIndex((sub) => sub.key === it.subtitleKey);
      request.activeTrackIds = chosen >= 0 ? [chosen + 1] : [];
      await castSession.loadMedia(request);
      setState((st) => ({ ...st, active: true, device: castSession.getCastDevice()?.friendlyName ?? null, time: at, playing: true, volume: player.current.volumeLevel ?? st.volume, muted: Boolean(player.current.isMuted), error: null }));
    },
    [],
  );

  /** Picks a Chromecast (the browser's own list) and continues there from `at`. */
  const start = useCallback(
    async (at: number) => {
      const f = framework.current;
      if (!f) return;
      try {
        const context = f.CastContext.getInstance();
        if (!context.getCurrentSession()) await context.requestSession();
        session.current = null;
        await load(at);
      } catch (err) {
        // Closing the list is not an error.
        const code = (err as { code?: string } | string | undefined) ?? '';
        if (code === 'cancel' || (typeof code === 'object' && code.code === 'cancel')) return;
        setState((st) => ({ ...st, error: err instanceof Error ? err.message : String((err as { description?: string })?.description ?? err) }));
      }
    },
    [load],
  );

  const stop = useCallback(() => {
    framework.current?.CastContext.getInstance().endCurrentSession(true);
    setState((st) => ({ ...st, active: false, device: null }));
  }, []);

  const togglePlay = useCallback(() => controller.current?.playOrPause(), []);

  const setVolume = useCallback((value: number) => {
    if (!player.current || !controller.current) return;
    const volume = Math.min(1, Math.max(0, value));
    player.current.volumeLevel = volume;
    controller.current.setVolumeLevel();
    setState((st) => ({ ...st, volume }));
  }, []);

  const toggleMute = useCallback(() => {
    if (!player.current || !controller.current) return;
    controller.current.muteOrUnmute();
    setState((st) => ({ ...st, muted: !st.muted }));
  }, []);

  const setAudio = useCallback((at: number, audioIndex: number | null) => {
    session.current = null;
    return load(at, audioIndex);
  }, [load]);

  const setSubtitle = useCallback((key: string | null) => {
    if (!session.current || !player.current || !controller.current) return;
    const index = session.current.subtitles.findIndex((subtitle) => subtitle.key === key);
    player.current.activeTrackIds = index >= 0 ? [index + 1] : [];
    controller.current.setActiveTrackIds();
  }, []);

  const seek = useCallback(
    (target: number) => {
      const s = session.current;
      if (!s || !player.current) return;
      const t = Math.max(0, target);
      setState((st) => ({ ...st, time: t }));
      // A repackaged stream starts again from the new spot; a file as it is seeks by itself.
      if (s.decision.seek === 'restart') void load(t);
      else {
        player.current.currentTime = t;
        controller.current.seek();
      }
    },
    [load],
  );

  return { ...state, start, stop, togglePlay, seek, setVolume, toggleMute, setAudio, setSubtitle, reload: load };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
