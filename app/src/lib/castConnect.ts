/**
 * Cast Connect on the TV: a phone or browser casts to a Google TV with the Vidalune app, and the app
 * opens the title in its own player (modules/vidalune-tv, CastConnect.kt). The senders put the
 * server, title, start and subtitle in the load's customData (castLoadRequest in lib/cast.ts, the
 * website's useCast); this turns that into a route, and the player's state into what senders read.
 */

/** A cast as the native module passes it on. */
export interface CastConnectLoad {
  customData: string | null;
  /** Seconds into the stream (a repackaged stream starts `offset` seconds into the file). */
  currentTime: number;
  activeTrackIds: number[];
}

interface Sent {
  serverId?: unknown;
  title?: { kind?: unknown; id?: unknown } | null;
  offset?: unknown;
  audioIndex?: unknown;
  subtitleKey?: unknown;
}

const PLAY = /^\/play\/(movie|episode)\/\d+(\?[\w=&.-]*)?$/;

/**
 * Where the app goes for a cast: the player on the title (at the sender's position, with its
 * subtitle and audio), via the server list when this TV is on another server (or none). Null when
 * the cast is not one from Vidalune. `n` numbers the cast.
 */
export function castConnectRoute(load: CastConnectLoad, serverId: string | null, n?: number): string | null {
  let sent: Sent | undefined;
  try {
    sent = (JSON.parse(load.customData ?? 'null') as { vidalune?: Sent } | null)?.vidalune;
  } catch {
    return null;
  }
  const kind = sent?.title?.kind;
  const id = sent?.title?.id;
  if (!sent || (kind !== 'movie' && kind !== 'episode') || typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  const offset = typeof sent.offset === 'number' && sent.offset > 0 ? sent.offset : 0;
  const at = Math.max(0, Math.floor(offset + (Number.isFinite(load.currentTime) ? load.currentTime : 0)));
  const params = [`t=${at}`, 'cast=1'];
  // The sender counts in its stream, which starts this far into the file: the player reports so.
  if (offset > 0) params.push(`o=${Number(offset.toFixed(3))}`);
  // The subtitle the sender showed ("-": none); its own choice, so it goes before what this TV remembers.
  if (typeof sent.subtitleKey === 'string' && /^[\w.-]+$/.test(sent.subtitleKey)) params.push(`sub=${sent.subtitleKey}`);
  else if (sent.subtitleKey === null) params.push('sub=-');
  if (typeof sent.audioIndex === 'number' && Number.isInteger(sent.audioIndex) && sent.audioIndex >= 0) params.push(`audio=${sent.audioIndex}`);
  // Each cast starts the player again (also on the title that plays: the sender jumped or chose other audio).
  if (n !== undefined) params.push(`n=${n}`);
  const play = `/play/${kind}/${id}?${params.join('&')}`;
  const server = typeof sent.serverId === 'string' && sent.serverId ? sent.serverId : null;
  if (!server) return null;
  return server === serverId ? play : `/cloud?server=${encodeURIComponent(server)}&then=${encodeURIComponent(play)}`;
}

/** The player route to go to after opening a server for a cast; null for anything else. */
export function castThen(then: string | undefined): string | null {
  return then && PLAY.test(then) ? then : null;
}

/** The subtitles a cast numbers (track i + 1 is subtitle i): text subtitles of the file, as the server lists them for casting. */
export function castSubtitleKeys(subtitles: { key: string; kind: string }[]): string[] {
  return subtitles.filter((s) => s.kind === 'external' || s.kind === 'embedded').map((s) => s.key);
}

/** The active track for a subtitle (empty: none). */
export function castTrackIdsFor(key: string | null, keys: string[]): number[] {
  const i = key === null ? -1 : keys.indexOf(key);
  return i >= 0 ? [i + 1] : [];
}

/** The subtitle a sender picked by track (0: none); undefined when the TV does not have it. */
export function castSubtitleFor(trackId: number, keys: string[]): string | null | undefined {
  if (trackId <= 0) return null;
  return keys[trackId - 1];
}

/** What senders read about the player's state. */
export function castPlayerState(s: { playing: boolean; loading: boolean }): 'playing' | 'paused' | 'buffering' {
  return s.loading ? 'buffering' : s.playing ? 'playing' : 'paused';
}

/** The customData senders read: the file and title the TV plays (they follow another title, as with the web player). */
export function castConnectData(item: { kind: 'movie' | 'episode'; id: number; fileId: number }, audioIndex: number | null): string {
  return JSON.stringify({ vidalune: { fileId: item.fileId, audioIndex, item: { kind: item.kind, id: item.id } } });
}

/**
 * The start a cast gave the player (route params): subtitle (null: none) and audio track, undefined
 * when not given; and where the sender's stream starts in the file (its positions count from there).
 */
export function castGiven(params: { sub?: string; audio?: string; o?: string }): { subtitleKey?: string | null; audioIndex?: number; offset: number } {
  const offset = Number(params.o);
  const out: { subtitleKey?: string | null; audioIndex?: number; offset: number } = { offset: Number.isFinite(offset) && offset > 0 ? offset : 0 };
  if (params.sub === '-') out.subtitleKey = null;
  else if (params.sub) out.subtitleKey = params.sub;
  const audio = params.audio === undefined ? NaN : Number(params.audio);
  if (Number.isInteger(audio) && audio >= 0) out.audioIndex = audio;
  return out;
}
