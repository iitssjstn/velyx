/**
 * Casting to a Chromecast (or a TV with Chromecast built in) from the app. The Chromecast fetches
 * the video itself, with a short-lived token for just this file (from `/api/cast/session`); the
 * player becomes its remote control. What to load is worked out here, without React Native, so it
 * is tested with Vitest; the player hands it to react-native-google-cast.
 */
import { DEFAULT_SUBTITLE_STYLE, castSubtitlePreview, readSubtitleStyle, type SubtitleStyle } from './subtitleStyle';
import type { MediaStreamType, TextTrackStyle } from 'react-native-google-cast';

export function castTextTrackStyle(style: SubtitleStyle = DEFAULT_SUBTITLE_STYLE): TextTrackStyle {
  style = castSubtitlePreview(style);
  return {
    fontFamily: 'sans-serif',
    fontGenericFamily: 'sansSerif',
    fontScale: { small: 0.8, medium: 1, large: 1.2, xlarge: 1.4 }[style.size],
    foregroundColor: style.color === 'yellow' ? '#FFE14DFF' : '#FFFFFFFF',
    // "None" is 1/255 visible, not 0: the Android cast library turns #00000000 into 0, which Google reads as
    // "no colour given", and the TV then keeps its own black box behind the subtitles.
    backgroundColor: { none: '#00000001', translucent: '#00000099', solid: '#000000EB' }[style.background],
    edgeType: ({ shadow: 'dropShadow', outline: 'outline', none: 'none' } as const)[style.edge],
    edgeColor: '#000000FF',
  };
}

/** Retry rejected custom styles with the TV preset; the caller reports the original failure. */
export async function applyCastTextTrackStyle(options: {
  style: () => SubtitleStyle;
  apply: (style: TextTrackStyle) => Promise<unknown>;
  active?: () => boolean;
  fallback: (error: unknown) => void;
}): Promise<boolean | null> {
  const active = options.active ?? (() => true);
  while (active()) {
    let fallback = false;
    const requested = options.style();
    const unchanged = () => JSON.stringify(readSubtitleStyle(options.style())) === JSON.stringify(readSubtitleStyle(requested));
    try {
      await options.apply(castTextTrackStyle(requested));
    } catch (error) {
      if (!active()) return null;
      if (!unchanged()) continue;
      if (readSubtitleStyle(requested).castDefaults) throw error;
      try {
        await options.apply(castTextTrackStyle());
      } catch (fallbackError) {
        if (!active()) return null;
        if (!unchanged()) continue;
        throw fallbackError;
      }
      if (!active()) return null;
      if (!unchanged()) continue;
      fallback = true;
      options.fallback(error);
    }
    if (!active()) return null;
    if (unchanged()) return fallback;
  }
  return null;
}

export interface CastSubtitle {
  key: string;
  label: string;
  language: string | null;
  url: string;
}

export interface CastSession {
  token: string;
  expiresAt: number;
  serverUrl: string | null;
  contentType: string;
  decision: { engine: string; streamUrl: string; seek: 'range' | 'restart'; durationSec: number | null; optimized?: { id: number; profile: 'compat-720p' | 'compat-1080p' } };
  subtitles: CastSubtitle[];
}

/** The same shape as react-native-google-cast's MediaLoadRequest (only what is used). */
export interface CastLoadRequest {
  autoplay: boolean;
  startTime: number;
  activeTrackIds: number[];
  mediaInfo: {
    contentUrl: string;
    contentType: string;
    streamType: MediaStreamType;
    streamDuration?: number;
    textTrackStyle: ReturnType<typeof castTextTrackStyle>;
    metadata: { type: 'generic'; title: string; subtitle?: string; images?: { url: string }[] };
    /** For Vidalune's own cast player: where it saves the TV's progress itself. */
    customData: { vidalune: { progressUrl: string; offset: number; durationSec: number | null; fileId: number | null; audioIndex: number | null } };
    mediaTracks: { id: number; type: 'text'; subtype: 'subtitles'; contentId: string; contentType: string; name: string; language?: string }[];
  };
}

/** An address for the Chromecast: absolute, with the token (and other parameters). */
export function castAddress(absoluteUrl: string, token: string, params: Record<string, string> = {}): string {
  const u = new URL(absoluteUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('cast', token);
  return u.toString();
}

/** A session still good for a while (a new one is asked for shortly before it runs out). */
export function sessionUsable(session: CastSession | null, audioIndex: number | null, sessionAudio: number | null, now = Date.now()): session is CastSession {
  return Boolean(session && session.expiresAt > now + 60_000 && audioIndex === sessionAudio);
}

/**
 * What the Chromecast loads to continue at `at` seconds into the file. A repackaged stream starts at
 * the keyframe before it (`keyframe`, from the server): its clock and subtitles count from there,
 * so `offset` is what the Chromecast's position is behind the file's.
 */
export function castLoadRequest(opts: {
  session: CastSession;
  /** Absolute address of a server path (the app's own server address). */
  url: (path: string) => string;
  title: string;
  subtitle: string | null;
  artwork: string | null;
  at: number;
  keyframe: { offset: number; seek: number } | null;
  subtitleKey: string | null;
  subtitleStyle?: SubtitleStyle;
  /** The file and audio track (Vidalune's TV player offers the others, and says which file it plays). */
  fileId?: number;
  audioIndex?: number | null;
}): { request: CastLoadRequest; offset: number } {
  const { session: s, url, at } = opts;
  const restart = s.decision.seek === 'restart' && at > 0 && opts.keyframe !== null;
  const offset = restart ? opts.keyframe!.offset : 0;
  const stream = castAddress(url(s.decision.streamUrl), s.token, restart ? { start: opts.keyframe!.seek.toFixed(3) } : {});
  const chosen = s.subtitles.findIndex((sub) => sub.key === opts.subtitleKey);
  return {
    offset,
    request: {
      autoplay: true,
      startTime: Math.max(0, at - offset),
      activeTrackIds: chosen >= 0 ? [chosen + 1] : [],
      mediaInfo: {
        contentUrl: stream,
        contentType: s.contentType,
        streamType: 'BUFFERED' as MediaStreamType,
        textTrackStyle: castTextTrackStyle(opts.subtitleStyle),
        ...(s.decision.durationSec ? { streamDuration: Math.max(0, s.decision.durationSec - offset) } : {}),
        // Vidalune's cast player saves where the TV is itself, also with the app in the background.
        customData: { vidalune: { progressUrl: castAddress(url('/api/cast/progress'), s.token), offset, durationSec: s.decision.durationSec, fileId: opts.fileId ?? null, audioIndex: opts.audioIndex ?? null } },
        metadata: {
          type: 'generic',
          title: opts.title,
          ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
          ...(opts.artwork ? { images: [{ url: castAddress(url(opts.artwork), s.token) }] } : {}),
        },
        mediaTracks: s.subtitles.map((sub, i) => ({
          id: i + 1,
          type: 'text' as const,
          subtype: 'subtitles' as const,
          // The same clock as the stream.
          contentId: castAddress(url(sub.url), s.token, offset > 0 ? { offset: offset.toFixed(3) } : {}),
          contentType: 'text/vtt',
          name: sub.label,
          ...(sub.language ? { language: sub.language } : {}),
        })),
      },
    },
  };
}

/** The subtitle tracks to show on the TV for a chosen subtitle (by key). */
export function castTrackIds(session: CastSession | null, subtitleKey: string | null): number[] {
  const i = session ? session.subtitles.findIndex((sub) => sub.key === subtitleKey) : -1;
  return i >= 0 ? [i + 1] : [];
}

export async function loadCastWithCurrentSubtitle(options: {
  request: CastLoadRequest;
  session: CastSession;
  subtitleKey: () => string | null;
  load: (request: CastLoadRequest) => Promise<unknown>;
  select: (ids: number[]) => Promise<unknown>;
  active?: () => boolean;
}): Promise<void> {
  const requested = options.subtitleKey();
  options.request.activeTrackIds = castTrackIds(options.session, requested);
  await options.load(options.request);
  if (options.active && !options.active()) return;
  const current = options.subtitleKey();
  if (current !== requested) await options.select(castTrackIds(options.session, current));
}

/**
 * Opens Google's Chromecast list. On Android it can only open through a native cast button on the
 * screen (the player keeps an invisible one); `false` means it did not open, which is said instead
 * of nothing happening.
 */
export async function openCastDialog(show: () => Promise<boolean>, failed: (message: 'player.castNoDialog' | Error) => void): Promise<void> {
  try {
    if (!(await show())) failed('player.castNoDialog');
  } catch (err) {
    failed(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * The file time the TV is at, from its stream position (a repackaged stream starts at `offset` in the
 * file). Null when the TV reports nothing usable yet.
 */
export function tvFilePosition(offset: number, streamSec: number): number | null {
  return Number.isFinite(streamSec) && streamSec > 0 ? offset + streamSec : null;
}

/**
 * What Vidalune's TV player says it plays (customData of its media status): the file, and the title
 * when the TV started it itself (the next episode, with its remote). Null for anything else.
 */
export function tvMedia(mediaInfo: unknown): { fileId: number; item: { kind: 'movie' | 'episode'; id: number } | null } | null {
  const data = (mediaInfo as { customData?: { vidalune?: { fileId?: unknown; item?: { kind?: unknown; id?: unknown } | null } } } | null | undefined)?.customData?.vidalune;
  if (!data || typeof data.fileId !== 'number') return null;
  const kind = data.item?.kind;
  const item = (kind === 'movie' || kind === 'episode') && typeof data.item?.id === 'number' ? { kind: kind as 'movie' | 'episode', id: data.item.id } : null;
  return { fileId: data.fileId, item };
}

/** The subtitle (key) the TV shows for its active tracks (track i + 1 is subtitle i); undefined when unknown. */
export function tvSubtitleKey(activeTrackIds: unknown, session: CastSession | null): string | null | undefined {
  if (!Array.isArray(activeTrackIds) || !session) return undefined;
  const id = activeTrackIds.find((n) => typeof n === 'number' && n >= 1 && n <= session.subtitles.length);
  return id ? session.subtitles[id - 1]!.key : null;
}

/**
 * The title to open because the TV started it itself (its remote: the next episode), or null. Only
 * when the TV was on this screen's file before (`before`): a TV still on an older title while this
 * screen gives it a new one is not followed back.
 */
export function followTv(before: number | null, tv: ReturnType<typeof tvMedia>, fileId: number): { kind: 'movie' | 'episode'; id: number } | null {
  if (!tv?.item || tv.fileId === fileId || before !== fileId) return null;
  return tv.item;
}
