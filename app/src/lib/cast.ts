/**
 * Casting to a Chromecast (or a TV with Chromecast built in) from the app. The Chromecast fetches
 * the video itself, with a short-lived token for just this file (from `/api/cast/session`); the
 * player becomes its remote control. What to load is worked out here, without React Native, so it
 * is tested with Vitest; the player hands it to react-native-google-cast.
 */

export interface CastSubtitle {
  key: string;
  label: string;
  language: string | null;
  url: string;
}

export interface CastSession {
  token: string;
  expiresAt: number;
  relayUrl: string | null;
  serverUrl: string | null;
  contentType: string;
  decision: { engine: string; streamUrl: string; seek: 'range' | 'restart'; durationSec: number | null };
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
    streamDuration?: number;
    metadata: { type: 'generic'; title: string; subtitle?: string; images?: { url: string }[] };
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
        ...(s.decision.durationSec ? { streamDuration: Math.max(0, s.decision.durationSec - offset) } : {}),
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
