import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, mediaFiles, movies, shows } from '../db/schema.js';

/** A stream counts as active while requests or progress updates keep arriving. */
const ACTIVE_MS = 60_000;

export interface ActiveStream {
  id: string;
  userId: number;
  username: string;
  mediaFileId: number;
  movieId: number | null;
  episodeId: number | null;
  title: string;
  subtitle: string | null;
  mode: 'direct' | 'remux';
  width: number | null;
  height: number | null;
  /** File bitrate in bits per second (from FFprobe), when known. */
  bitrate: number | null;
  device: string | null;
  startedAt: number;
  lastSeenAt: number;
  /** Last reported playback position in seconds. */
  positionSec: number | null;
  durationSec: number | null;
}

/**
 * Keeps track of who is watching what, from the stream requests themselves and the player's
 * periodic progress saves. In memory only: nothing is written per request.
 */
export class StreamTracker {
  private streams = new Map<string, ActiveStream>();

  constructor(private readonly db: DB) {}

  /** Called for every stream request (direct range requests and remux starts). */
  touch(user: { id: number; username: string }, fileId: number, mode: 'direct' | 'remux', device: string | null, now = Date.now()): ActiveStream | null {
    const key = `${user.id}:${fileId}`;
    const existing = this.streams.get(key);
    if (existing && now - existing.lastSeenAt < ACTIVE_MS) {
      existing.lastSeenAt = now;
      existing.mode = mode;
      return existing;
    }
    const f = this.db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
    if (!f) return null;
    // Forget finished streams here too, so the map stays small when nobody opens the dashboard.
    this.prune(now);
    let title = 'Unknown';
    let subtitle: string | null = null;
    if (f.movieId) {
      const m = this.db.select({ title: movies.title, year: movies.year }).from(movies).where(eq(movies.id, f.movieId)).get();
      title = m?.title ?? title;
      subtitle = m?.year ? String(m.year) : null;
    } else if (f.episodeId) {
      const e = this.db
        .select({ show: shows.title, s: episodes.seasonNumber, e: episodes.episodeNumber, title: episodes.title })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(eq(episodes.id, f.episodeId))
        .get();
      if (e) {
        title = e.show;
        subtitle = `S${String(e.s).padStart(2, '0')}E${String(e.e).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`;
      }
    }
    const stream: ActiveStream = {
      id: key,
      userId: user.id,
      username: user.username,
      mediaFileId: fileId,
      movieId: f.movieId,
      episodeId: f.episodeId,
      title,
      subtitle,
      mode,
      width: f.width,
      height: f.height,
      bitrate: f.bitrate,
      device,
      startedAt: now,
      lastSeenAt: now,
      positionSec: null,
      durationSec: f.durationSec,
    };
    this.streams.set(key, stream);
    return stream;
  }

  /** Called when the player saves progress: keeps the stream alive and records the position. */
  progress(userId: number, target: { movieId?: number; episodeId?: number }, positionSec: number, now = Date.now()): void {
    for (const s of this.streams.values()) {
      if (s.userId !== userId) continue;
      if ((target.movieId && s.movieId === target.movieId) || (target.episodeId && s.episodeId === target.episodeId)) {
        s.positionSec = positionSec;
        s.lastSeenAt = now;
      }
    }
  }

  private prune(now: number): void {
    for (const [k, s] of this.streams) if (now - s.lastSeenAt >= ACTIVE_MS) this.streams.delete(k);
  }

  /** Number of streams held in memory (active or not yet pruned). */
  get size(): number {
    return this.streams.size;
  }

  active(now = Date.now()): ActiveStream[] {
    this.prune(now);
    return [...this.streams.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
}
