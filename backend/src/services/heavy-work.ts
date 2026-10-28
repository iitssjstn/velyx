import { HttpError } from '../http-error.js';

/**
 * Work that reads a whole file with FFmpeg or FFprobe (keyframes, embedded subtitles, where a seek
 * lands): on a NAS that is minutes of disk and processor. One viewer may have only a few running at
 * once, so nobody can make the server unusable for everyone by asking for every file. Asking for
 * something already running for you (the same key) joins it and costs nothing extra.
 */
export class HeavyWork {
  private readonly running = new Map<number, Map<string, number>>();

  constructor(private readonly perUser = 3) {}

  /** Starts `work` for this user, or refuses (429) when they already have their share running. */
  track<T>(userId: number, key: string, work: () => Promise<T>): Promise<T> {
    const mine = this.running.get(userId) ?? new Map<string, number>();
    if (!mine.has(key) && mine.size >= this.perUser) throw new HttpError(429, 'Wait until what is being prepared for you is ready, then try again.');
    mine.set(key, (mine.get(key) ?? 0) + 1);
    this.running.set(userId, mine);
    const done = () => {
      const left = (mine.get(key) ?? 1) - 1;
      if (left > 0) mine.set(key, left);
      else mine.delete(key);
      if (!mine.size) this.running.delete(userId);
    };
    let started: Promise<T>;
    try {
      started = work();
    } catch (err) {
      done();
      throw err;
    }
    return started.finally(done);
  }

  /** How many this user has running (for tests and the log). */
  count(userId: number): number {
    return this.running.get(userId)?.size ?? 0;
  }
}
