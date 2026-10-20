import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { CAST_SUBTITLE_DEFAULTS, readSubtitlePrefs, type PlaybackPrefs } from './prefs';
import { t } from '../i18n';

export type CastSubtitleStyle = Pick<PlaybackPrefs, 'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitleEdge'> & Partial<Pick<PlaybackPrefs, 'castSubtitleDefaults'>>;

export function castTextTrackStyle(style?: CastSubtitleStyle) {
  const saved = readSubtitlePrefs(style ?? {});
  const current = saved.castSubtitleDefaults ? CAST_SUBTITLE_DEFAULTS : saved;
  return {
    fontFamily: 'sans-serif',
    fontGenericFamily: 'SANS_SERIF',
    fontScale: { small: 0.8, medium: 1, large: 1.2, xlarge: 1.4 }[current.subtitleSize],
    foregroundColor: current.subtitleColor === 'yellow' ? '#FFE14DFF' : '#FFFFFFFF',
    // "None" is 1/255 visible, not 0: the Android cast library turns #00000000 into 0, which Google reads as
    // "no colour given", and the TV then keeps its own black box behind the subtitles.
    backgroundColor: { none: '#00000001', translucent: '#00000099', solid: '#000000EB' }[current.subtitleBackground],
    edgeType: { shadow: 'DROP_SHADOW', outline: 'OUTLINE', none: 'NONE' }[current.subtitleEdge],
    edgeColor: '#000000FF',
  };
}

/** Unsupported styles fall back without reloading or interrupting the video. */
export async function applyCastSubtitleStyle(style: CastSubtitleStyle | undefined, apply: (style: ReturnType<typeof castTextTrackStyle>) => Promise<void>): Promise<void> {
  try {
    await apply(castTextTrackStyle(style));
  } catch {
    await apply(castTextTrackStyle());
  }
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
  directUrl: string | null;
  serverUrl: string | null;
  expiresAt: number;
  contentType: string;
  decision: { engine: string; streamUrl: string; seek: 'range' | 'restart'; durationSec: number | null; optimized?: { id: number; profile: 'compat-720p' | 'compat-1080p' } };
  subtitles: CastSubtitle[];
  }

/** The Chromecast must fetch media directly from the server; the account-site relay is never a media host. */
export function castBase(origin: string, s: Pick<CastSession, 'directUrl' | 'serverUrl'>): string | null {
  const host = new URL(origin).hostname;
  const trim = (u: string) => u.replace(/\/+$/, '');
  if (host === 'app.vidalune.com') return s.directUrl ? trim(s.directUrl) : null;
  if (s.directUrl) return trim(s.directUrl);
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
/** Vidalune's own cast player (cast.vidalune.com), registered with Google Cast. */
export const VIDALUNE_CAST_APP_ID = '920BF057';

/** How far before the asked start the TV may begin (it starts at a keyframe) and still count as there. */
export const CAST_START_SLACK_SEC = 15;
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
      context.setOptions({ receiverApplicationId: VIDALUNE_CAST_APP_ID, autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
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
  /** This browser can cast (Chrome): the button shows, and its list searches the network itself. */
  supported: boolean;
  /** A Chromecast has been found around. */
  available: boolean;
  /** A Chromecast was picked and is being connected, or is being given the title. */
  connecting: boolean;
  /** Playing on a Chromecast now. */
  active: boolean;
  /** The file the TV was given (null while not casting): another file means the TV is still on the old one. */
  fileId: number | null;
  device: string | null;
  /** Position in the file (seconds). */
  time: number;
  /**
   * The TV got to where it was asked to start (the resume point). Until then its position is not
   * saved: a TV that begins at the start of the stream would otherwise overwrite the resume point.
   */
  settled: boolean;
  playing: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
  /** A title the TV started itself (the next episode, with its remote): the page follows it. */
  tvItem: { kind: 'movie' | 'episode'; id: number; fileId: number } | null;
  /** The subtitle on the TV (also one chosen there), once known; null = off. */
  tvSubtitleKey?: string | null;
  /** The audio track the TV plays (also one chosen there), once known; null = the file's default. */
  tvAudioIndex?: number | null;
}

/** How long a subtitle chosen here wins over what the TV still reports. */
const SUBTITLE_SETTLE_MS = 5000;

/** What Vidalune's TV player says it plays (customData of its media), or null. */
export function tvMedia(mediaInfo: unknown): { fileId: number; item: { kind: 'movie' | 'episode'; id: number } | null; audioIndex: number | null } | null {
  const data = (mediaInfo as { customData?: { vidalune?: { fileId?: unknown; item?: { kind?: unknown; id?: unknown } | null; audioIndex?: unknown } } } | null | undefined)?.customData?.vidalune;
  if (!data || typeof data.fileId !== 'number') return null;
  const item = data.item && (data.item.kind === 'movie' || data.item.kind === 'episode') && typeof data.item.id === 'number' ? { kind: data.item.kind as 'movie' | 'episode', id: data.item.id } : null;
  return { fileId: data.fileId, item, audioIndex: typeof data.audioIndex === 'number' ? data.audioIndex : null };
}

/** The subtitle key for the TV's active tracks (track i + 1 is subtitle i), or undefined when unknown. */
export function tvSubtitle(activeTrackIds: unknown, subtitles: Pick<CastSubtitle, 'key'>[]): string | null | undefined {
  if (!Array.isArray(activeTrackIds)) return undefined;
  const id = activeTrackIds.find((n) => typeof n === 'number' && n >= 1 && n <= subtitles.length);
  return id ? subtitles[id - 1]!.key : null;
}

/**
 * The player's side of casting: start (the TV continues where the page was), play/pause, seek
 * (a repackaged stream is loaded again from the new spot), and the position while it plays.
 */
export function useCast(item: CastItem | null) {
  const [state, setState] = useState<CastState>({ supported: false, available: false, connecting: false, settled: false, active: false, fileId: null, device: null, time: 0, playing: false, volume: 1, muted: false, error: null, tvItem: null });
  const framework = useRef<any>(null);
  const availableRef = useRef(false);
  // Where the TV was last asked to start (in the file).
  const startedAt = useRef(0);
  // start() is under way (connecting, then giving the TV the title).
  const starting = useRef(false);
  const player = useRef<any>(null);
  const controller = useRef<any>(null);
  const session = useRef<CastSession | null>(null);
  const offset = useRef(0);
  // The file on the TV (loaded here or by the TV itself), and its subtitles as the TV numbers them.
  const tvFile = useRef<number | null>(null);
  const tvSubtitles = useRef<{ fileId: number; subtitles: CastSubtitle[] } | null>(null);
  // A subtitle chosen here, until the TV reports it.
  const pendingSubtitle = useRef<{ key: string | null; until: number } | null>(null);
  // Quick seeks each load the stream again: only the latest may reach the TV, whatever finishes first.
  const loads = useRef(0);
  const itemRef = useRef(item);
  const subtitleKey = useRef(item?.subtitleKey ?? null);
  if (itemRef.current?.fileId !== item?.fileId || itemRef.current?.subtitleKey !== item?.subtitleKey) subtitleKey.current = item?.subtitleKey ?? null;
  // The cast session (its token and stream) belongs to one file: another file needs a new one.
  if (itemRef.current?.fileId !== item?.fileId) session.current = null;
  itemRef.current = item;
  const styleKey = JSON.stringify(item?.subtitleStyle);
  const styleUpdates = useRef(Promise.resolve());
  const mounted = useRef(true);
  const setStyle = useCallback(() => {
    const context = framework.current?.CastContext.getInstance();
    const mediaSession = context?.getCurrentSession()?.getMediaSession?.();
    if (!mediaSession?.editTracksInfo) return Promise.resolve();
    const update = styleUpdates.current.catch(() => undefined).then(async () => {
      // Serialize updates and read the latest choice after a delayed receiver response.
      while (mounted.current && context.getCurrentSession()?.getMediaSession?.() === mediaSession) {
        const requested = itemRef.current?.subtitleStyle;
        await applyCastSubtitleStyle(requested, (style) => new Promise<void>((resolve, reject) => {
          const request = new w.chrome.cast.media.EditTracksInfoRequest();
          request.textTrackStyle = Object.assign(new w.chrome.cast.media.TextTrackStyle(), style);
          mediaSession.editTracksInfo(request, resolve, reject);
        }));
        if (JSON.stringify(requested) === JSON.stringify(itemRef.current?.subtitleStyle)) return;
      }
    });
    styleUpdates.current = update;
    return update;
  }, []);

  // The page caught up with a title the TV started itself: from here on the page leads again.
  useEffect(() => {
    if (state.tvItem && item?.fileId === state.tvItem.fileId) setState((st) => ({ ...st, tvItem: null }));
  }, [state.tvItem, item?.fileId]);

  useEffect(() => {
    if (state.active) void setStyle().catch((error) => setState((st) => ({ ...st, error: error instanceof Error ? error.message : String(error) })));
  }, [state.active, styleKey, setStyle]);

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    let cleanup: (() => void) | undefined;
    void loadCastSdk().then((f) => {
      if (!alive || !f) return;
      framework.current = f;
      const context = f.CastContext.getInstance();
      const update = () => {
        const s = context.getCastState();
        setState((st) => ({ ...st, supported: true, available: s !== f.CastState.NO_DEVICES_AVAILABLE, connecting: s === f.CastState.CONNECTING || starting.current }));
        availableRef.current = s !== f.CastState.NO_DEVICES_AVAILABLE;
      };
      context.addEventListener(f.CastContextEventType.CAST_STATE_CHANGED, update);
      update();
      player.current = new f.RemotePlayer();
      controller.current = new f.RemotePlayerController(player.current);
      const c = controller.current;
      /** What the TV plays and which subtitle it shows: it can change them itself (its remote). */
      const readTv = () => {
        const tv = tvMedia(player.current.mediaInfo);
        if (tv && tvFile.current !== null && tv.fileId !== tvFile.current && tv.item) {
          // The TV started another title (the next episode): this page follows it.
          tvFile.current = tv.fileId;
          offset.current = 0;
          startedAt.current = 0;
          setState((st) => ({ ...st, fileId: tv.fileId, settled: true, tvItem: { ...tv.item!, fileId: tv.fileId } }));
          void api.post<CastSession>('/api/cast/session', { fileId: tv.fileId }).then((s) => {
            if (tvFile.current === tv.fileId) tvSubtitles.current = { fileId: tv.fileId, subtitles: s.subtitles };
          }).catch(() => undefined);
        }
        if (tv && tv.fileId === tvFile.current) setState((st) => (st.tvAudioIndex === tv.audioIndex ? st : { ...st, tvAudioIndex: tv.audioIndex }));
        const list = tvSubtitles.current;
        if (!list || list.fileId !== tvFile.current) return;
        const ids = f.CastContext.getInstance().getCurrentSession()?.getMediaSession?.()?.activeTrackIds ?? player.current.activeTrackIds;
        const key = tvSubtitle(ids, list.subtitles);
        if (key === undefined) return;
        const pending = pendingSubtitle.current;
        if (pending && key !== pending.key && Date.now() < pending.until) return;
        pendingSubtitle.current = null;
        setState((st) => (st.tvSubtitleKey === key ? st : { ...st, tvSubtitleKey: key }));
      };
      const listeners: Array<[string, () => void]> = [
        [f.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => {
          setState((st) => {
            const time = offset.current + (player.current.currentTime ?? 0);
            return { ...st, time, settled: st.settled || time + CAST_START_SLACK_SEC >= startedAt.current };
          });
          readTv();
        }],
        ...(f.RemotePlayerEventType.MEDIA_INFO_CHANGED ? [[f.RemotePlayerEventType.MEDIA_INFO_CHANGED, readTv] as [string, () => void]] : []),
        [f.RemotePlayerEventType.IS_PAUSED_CHANGED, () => setState((st) => ({ ...st, playing: !player.current.isPaused }))],
        [f.RemotePlayerEventType.VOLUME_LEVEL_CHANGED, () => setState((st) => ({ ...st, volume: player.current.volumeLevel ?? st.volume }))],
        [f.RemotePlayerEventType.IS_MUTED_CHANGED, () => setState((st) => ({ ...st, muted: Boolean(player.current.isMuted) }))],
        [f.RemotePlayerEventType.IS_CONNECTED_CHANGED, () => {
          if (!player.current.isConnected) {
            tvFile.current = null;
            setState((st) => ({ ...st, active: false, fileId: null, device: null, tvItem: null, tvSubtitleKey: undefined, tvAudioIndex: undefined }));
          }
        }],
      ];
      for (const [type, listener] of listeners) c.addEventListener(type, listener);
      cleanup = () => {
        context.removeEventListener(f.CastContextEventType.CAST_STATE_CHANGED, update);
        for (const [type, listener] of listeners) c.removeEventListener(type, listener);
      };
    });
    return () => {
      alive = false;
      mounted.current = false;
      cleanup?.();
    };
  }, []);

  /** Loads the file on the Chromecast from `at` (seconds in the file). */
  const load = useCallback(
    async (at: number, audioOverride?: number | null) => {
      const it = itemRef.current;
      const f = framework.current;
      const castSession = f?.CastContext.getInstance().getCurrentSession();
      if (!it || !castSession) return;
      const loadId = ++loads.current;
      const chromeCast = w.chrome.cast;
      const audioIndex = audioOverride === undefined ? it.audioIndex : audioOverride;
      if (!session.current || session.current.expiresAt < Date.now() + 60_000 || audioOverride !== undefined) session.current = await api.post<CastSession>('/api/cast/session', { fileId: it.fileId, ...(audioIndex !== null ? { audioIndex } : {}), ...(it.optimizationId ? { optimizationId: it.optimizationId } : {}) });
      if (loadId !== loads.current) return;
      const s = session.current;
      const base = castBase(window.location.origin, s);
      if (!base) throw new Error(t('player.errors.directServerRequired'));
      let start = 0;
      let startTime = at;
      if (s.decision.seek === 'restart' && at > 0) {
        const k = await it.locate(at);
        if (loadId !== loads.current) return;
        start = k.seek;
        offset.current = k.offset;
        startTime = Math.max(0, at - k.offset);
      } else offset.current = 0;
      const media = new chromeCast.media.MediaInfo(castUrl(base, s.decision.streamUrl, s.token, start), s.contentType);
      media.streamType = chromeCast.media.StreamType.BUFFERED;
      // Receiver defaults remain usable even when it cannot apply a custom style.
      media.textTrackStyle = Object.assign(new chromeCast.media.TextTrackStyle(), castTextTrackStyle());
      const meta = new chromeCast.media.GenericMediaMetadata();
      meta.title = it.title;
      if (it.subtitle) meta.subtitle = it.subtitle;
      if (it.posterPath) meta.images = [new chromeCast.Image(castUrl(base, `/api/images/w342/${it.posterPath.replace(/^\//, '')}`, s.token))];
      media.metadata = meta;
      media.duration = s.decision.durationSec ?? undefined;
      // Vidalune's cast player saves where the TV is itself, also with this page closed.
      media.customData = { vidalune: { progressUrl: castUrl(base, '/api/cast/progress', s.token), offset: offset.current, durationSec: s.decision.durationSec, fileId: it.fileId, audioIndex } };
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
      const requestedSubtitle = subtitleKey.current;
      const chosen = s.subtitles.findIndex((sub) => sub.key === requestedSubtitle);
      request.activeTrackIds = chosen >= 0 ? [chosen + 1] : [];
      startedAt.current = at;
      tvFile.current = it.fileId;
      tvSubtitles.current = { fileId: it.fileId, subtitles: s.subtitles };
      pendingSubtitle.current = { key: requestedSubtitle, until: Date.now() + SUBTITLE_SETTLE_MS };
      setState((st) => ({ ...st, settled: false, tvItem: null, tvSubtitleKey: requestedSubtitle }));
      await castSession.loadMedia(request);
      if (subtitleKey.current !== requestedSubtitle && player.current && controller.current) {
        const latest = s.subtitles.findIndex((sub) => sub.key === subtitleKey.current);
        player.current.activeTrackIds = latest >= 0 ? [latest + 1] : [];
        controller.current.setActiveTrackIds();
      }
      setState((st) => ({ ...st, active: true, fileId: it.fileId, tvItem: null, device: castSession.getCastDevice()?.friendlyName ?? null, time: at, playing: true, volume: player.current.volumeLevel ?? st.volume, muted: Boolean(player.current.isMuted), error: null }));
      // Styling must not prevent takeover of a video that is already playing on the TV.
      await setStyle().catch((error) => setState((st) => ({ ...st, error: error instanceof Error ? error.message : String(error) })));
    },
    [setStyle],
  );

  /** Picks a Chromecast (the browser's own list) and continues there from `at`. */
  const start = useCallback(
    async (at: number) => {
      const f = framework.current;
      if (!f) return;
      // A new try: the same problem again is shown again.
      setState((st) => ({ ...st, error: null }));
      starting.current = true;
      try {
        const context = f.CastContext.getInstance();
        if (!context.getCurrentSession()) await context.requestSession();
        setState((st) => ({ ...st, connecting: true }));
        session.current = null;
        await load(at);
      } catch (err) {
        // Closing the list is not an error.
        const code = (err as { code?: string } | string | undefined) ?? '';
        const name = typeof code === 'object' ? code.code : code;
        if (name === 'cancel') return;
        // The button shows before a Chromecast was found: none on this network.
        // (Chrome says session_error when it finds none at all.)
        if (name === 'receiver_unavailable' || (name === 'session_error' && !availableRef.current)) return setState((st) => ({ ...st, error: t('player.castNoDevice') }));
        setState((st) => ({ ...st, error: err instanceof Error ? err.message : String((err as { description?: string })?.description ?? err) }));
      } finally {
        starting.current = false;
        setState((st) => ({ ...st, connecting: false }));
      }
    },
    [load],
  );

  const stop = useCallback(() => {
    framework.current?.CastContext.getInstance().endCurrentSession(true);
    tvFile.current = null;
    setState((st) => ({ ...st, active: false, fileId: null, device: null, tvItem: null, tvSubtitleKey: undefined, tvAudioIndex: undefined }));
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
    subtitleKey.current = key;
    // The subtitles of the file on the TV (also one the TV started itself).
    const list = tvSubtitles.current && tvSubtitles.current.fileId === tvFile.current ? tvSubtitles.current.subtitles : session.current?.subtitles;
    if (!list || !player.current || !controller.current) return;
    pendingSubtitle.current = { key, until: Date.now() + SUBTITLE_SETTLE_MS };
    setState((st) => ({ ...st, tvSubtitleKey: key }));
    const index = list.findIndex((subtitle) => subtitle.key === key);
    player.current.activeTrackIds = index >= 0 ? [index + 1] : [];
    controller.current.setActiveTrackIds();
  }, []);

  const seek = useCallback(
    (target: number) => {
      const s = session.current;
      // Without a session here the TV plays a title it started itself, which seeks by itself.
      if (!player.current || (!s && tvFile.current === null)) return;
      const t = Math.max(0, target);
      setState((st) => ({ ...st, time: t }));
      // A repackaged stream starts again from the new spot; a file as it is seeks by itself.
      if (s?.decision.seek === 'restart') void load(t).catch((error) => setState((st) => ({ ...st, error: error instanceof Error ? error.message : String(error) })));
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
