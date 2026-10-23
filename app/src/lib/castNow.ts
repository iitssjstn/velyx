/** What the Chromecast plays now, for the cast bar under the screens (null: nothing of Vidalune's). */
export interface CastNow {
  title: string;
  subtitle: string | null;
  /** The poster the TV was given (an address on the server with the cast token). */
  image: string | null;
  /** The film or episode, to open its remote again; null when the TV did not say. */
  item: { kind: 'movie' | 'episode'; id: number } | null;
  /** Length of the file (seconds), when known. */
  duration: number | null;
  /** Where the stream starts in the file: the TV's position counts from there. */
  offset: number;
}

type Kind = 'movie' | 'episode';
const titleRef = (v: unknown): { kind: Kind; id: number } | null => {
  const r = v as { kind?: unknown; id?: unknown } | null | undefined;
  return r && (r.kind === 'movie' || r.kind === 'episode') && typeof r.id === 'number' ? { kind: r.kind, id: r.id } : null;
};

export function castNow(mediaInfo: unknown): CastNow | null {
  const info = mediaInfo as { metadata?: { title?: unknown; subtitle?: unknown; images?: { url?: unknown }[] }; customData?: { vidalune?: Record<string, unknown> } } | null | undefined;
  const data = info?.customData?.vidalune;
  if (!data || typeof data.fileId !== 'number') return null;
  const meta = info.metadata ?? {};
  const image = meta.images?.[0]?.url;
  return {
    title: typeof meta.title === 'string' ? meta.title : '',
    subtitle: typeof meta.subtitle === 'string' && meta.subtitle ? meta.subtitle : null,
    image: typeof image === 'string' ? image : null,
    // Senders give it as `title`, a title the TV started itself as `item`.
    item: titleRef(data.item) ?? titleRef(data.title),
    duration: typeof data.durationSec === 'number' && data.durationSec > 0 ? data.durationSec : null,
    offset: typeof data.offset === 'number' ? data.offset : 0,
  };
}

/**
 * Where tapping the bar goes: the title's remote, attached to what the TV plays (no new load), rising
 * from the bar (`bar=1`).
 */
export function castNowRoute(now: CastNow | null): string | null {
  return now?.item ? `/play/${now.item.kind}/${now.item.id}?tv=1&bar=1` : null;
}

/** Share of the title played (0 to 1), for the thin line under the bar. */
export function castNowShare(now: CastNow | null, streamSec: number | null): number {
  if (!now?.duration || streamSec === null) return 0;
  return Math.min(1, Math.max(0, (now.offset + streamSec) / now.duration));
}
