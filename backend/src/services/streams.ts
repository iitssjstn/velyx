import { eq, isNull, lt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, mediaFiles, movies, playbackSessions, shows } from '../db/schema.js';

/** A stream counts as active while requests or progress updates keep arriving. */
const ACTIVE_MS = 60_000;
/** A stream opened and left again within this time without playing is not kept in the history. */
const ABANDONED_MS = 30_000;
/** History is kept this long. */
const HISTORY_DAYS = 730;

export interface ActiveStream {
  id: string;
  /** The playback_sessions row recording this viewing. */
  sessionId: number;
  userId: number;
  username: string;
  mediaFileId: number;
  movieId: number | null;
  episodeId: number | null;
  showId: number | null;
  title: string;
  subtitle: string | null;
  mode: 'direct' | 'remux';
  /** What the remux does with the audio (e.g. "AAC 5.1"); null = passed through. */
  audioConversion: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
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
  /** Seconds actually played so far. */
  watchedSec: number;
}

interface Internal extends ActiveStream {
  lastProgressAt: number | null;
}

const publicView = ({ lastProgressAt: _p, ...s }: Internal): ActiveStream => ({ ...s });

/**
 * Keeps track of who is watching what, from the stream requests themselves and the player's
 * periodic progress saves, and records each viewing in playback_sessions for the activity log.
 * The database is written when a viewing starts, on progress saves and when it ends — never per
 * stream request.
 */
export class StreamTracker {
  private streams = new Map<string, Internal>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DB) {
    // Viewings that were running when Velyx stopped ended at their last sign of life.
    const open = this.db.select().from(playbackSessions).where(isNull(playbackSessions.endedAt)).all();
    for (const r of open) this.finish(r.id, r.startedAt, r.lastSeenAt, r.watchedSec);
  }

  /** Ends inactive viewings even when nobody asks for the active list (every minute). */
  start(): void {
    this.timer ??= setInterval(() => this.prune(Date.now()), ACTIVE_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [k, s] of this.streams) {
      this.finish(s.sessionId, s.startedAt, s.lastSeenAt, s.watchedSec);
      this.streams.delete(k);
    }
  }

  /** Called for every stream request (direct range requests and remux starts). */
  touch(user: { id: number; username: string }, fileId: number, mode: 'direct' | 'remux', device: string | null, audioConversion: string | null = null, now = Date.now()): ActiveStream | null {
    const key = `${user.id}:${fileId}`;
    const existing = this.streams.get(key);
    if (existing && now - existing.lastSeenAt < ACTIVE_MS) {
      existing.lastSeenAt = now;
      if (existing.mode !== mode || existing.audioConversion !== audioConversion) {
        existing.mode = mode;
        existing.audioConversion = audioConversion;
        this.db.update(playbackSessions).set({ mode, audioConversion, lastSeenAt: now }).where(eq(playbackSessions.id, existing.sessionId)).run();
      }
      return publicView(existing);
    }
    const f = this.db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
    if (!f) return null;
    // Forget finished streams here too, so the map stays small when nobody opens the dashboard.
    this.prune(now);
    let title = 'Unknown';
    let subtitle: string | null = null;
    let showId: number | null = null;
    if (f.movieId) {
      const m = this.db.select({ title: movies.title, year: movies.year }).from(movies).where(eq(movies.id, f.movieId)).get();
      title = m?.title ?? title;
      subtitle = m?.year ? String(m.year) : null;
    } else if (f.episodeId) {
      const e = this.db
        .select({ showId: shows.id, show: shows.title, s: episodes.seasonNumber, e: episodes.episodeNumber, title: episodes.title })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(eq(episodes.id, f.episodeId))
        .get();
      if (e) {
        title = e.show;
        showId = e.showId;
        subtitle = `S${String(e.s).padStart(2, '0')}E${String(e.e).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`;
      }
    }
    const details = {
      userId: user.id,
      username: user.username,
      movieId: f.movieId,
      episodeId: f.episodeId,
      showId,
      mediaFileId: fileId,
      title,
      subtitle,
      mode,
      audioConversion,
      container: f.container,
      videoCodec: f.videoCodec,
      audioCodec: f.audioCodec,
      width: f.width,
      height: f.height,
      bitrate: f.bitrate,
      device,
      startedAt: now,
      lastSeenAt: now,
    };
    const row = this.db
      .insert(playbackSessions)
      .values({ ...details, kind: f.movieId ? 'movie' : 'episode', durationSec: f.durationSec === null ? null : Math.round(f.durationSec) })
      .returning({ id: playbackSessions.id })
      .get();
    const stream: Internal = { ...details, id: key, sessionId: row.id, positionSec: null, durationSec: f.durationSec, watchedSec: 0, lastProgressAt: null };
    this.streams.set(key, stream);
    return publicView(stream);
  }

  /** Called when the player saves progress: keeps the stream alive and records the position and time watched. */
  progress(userId: number, target: { movieId?: number; episodeId?: number }, positionSec: number, now = Date.now()): void {
    for (const s of this.streams.values()) {
      if (s.userId !== userId) continue;
      if (!((target.movieId && s.movieId === target.movieId) || (target.episodeId && s.episodeId === target.episodeId))) continue;
      // Only real playing counts: the position must have moved, and never by more than the time
      // that passed allows (at up to double speed), so seeking and pauses add nothing.
      const since = (now - (s.lastProgressAt ?? s.startedAt)) / 1000;
      const moved = s.positionSec === null ? Math.min(since, 15) : positionSec - s.positionSec;
      if (moved > 0) s.watchedSec += Math.min(moved, since * 2 + 1);
      const first = s.positionSec === null;
      s.positionSec = positionSec;
      s.lastSeenAt = now;
      s.lastProgressAt = now;
      this.db
        .update(playbackSessions)
        .set({ positionSec: Math.round(positionSec), watchedSec: Math.round(s.watchedSec), lastSeenAt: now, ...(first ? { startPositionSec: Math.max(0, Math.round(positionSec - s.watchedSec)) } : {}) })
        .where(eq(playbackSessions.id, s.sessionId))
        .run();
    }
  }

  /** Closes a viewing; one that never really played is dropped instead of cluttering the history. */
  private finish(id: number, startedAt: number, lastSeenAt: number, watchedSec: number): void {
    if (watchedSec < 1 && lastSeenAt - startedAt < ABANDONED_MS) this.db.delete(playbackSessions).where(eq(playbackSessions.id, id)).run();
    else this.db.update(playbackSessions).set({ endedAt: lastSeenAt, lastSeenAt, watchedSec: Math.round(watchedSec) }).where(eq(playbackSessions.id, id)).run();
  }

  private prune(now: number): void {
    for (const [k, s] of this.streams) {
      if (now - s.lastSeenAt < ACTIVE_MS) continue;
      this.finish(s.sessionId, s.startedAt, s.lastSeenAt, s.watchedSec);
      this.streams.delete(k);
    }
  }

  /** Removes history older than two years (run with the other periodic clean-ups). */
  purgeHistory(now = Date.now()): number {
    return this.db
      .delete(playbackSessions)
      .where(lt(playbackSessions.startedAt, now - HISTORY_DAYS * 86_400_000))
      .run().changes;
  }

  /** Number of streams held in memory (active or not yet pruned). */
  get size(): number {
    return this.streams.size;
  }

  active(now = Date.now()): ActiveStream[] {
    this.prune(now);
    return [...this.streams.values()].sort((a, b) => a.startedAt - b.startedAt).map(publicView);
  }
}
