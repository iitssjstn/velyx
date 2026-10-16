/**
 * Vidalune's cast player saving where the TV is, with the address and token the sender gave it
 * (`customData` of the media it loaded). Without a phone or browser in between, progress is kept
 * when the phone is locked, the app is in the background or the page is closed.
 */

/** How often a playing title is saved. */
export const SAVE_EVERY_MS = 10_000;

/** How far before the asked start the TV may begin (it starts at a keyframe) and still count as there. */
export const START_SLACK_SEC = 15;

/**
 * What to save: the position in the file (a repackaged stream can start `offset` seconds into it)
 * and its length. Null when there is nothing worth saving (no length, or not started).
 */
export function progressReport(item, time, duration, ended = false) {
  const length = item.durationSec > 0 ? item.durationSec : Number.isFinite(duration) && duration > 0 ? item.offset + duration : null;
  if (!length) return null;
  const position = ended ? length : Math.min(length, item.offset + (Number.isFinite(time) ? Math.max(0, time) : 0));
  if (!ended && position < 1) return null;
  return { positionSec: Math.round(position * 10) / 10, durationSec: Math.round(length * 10) / 10 };
}

/** The sender's part of a load: where to save, or null (another sender, or an older Vidalune). */
export function progressTarget(customData) {
  const data = customData && typeof customData === 'object' ? customData.vidalune : null;
  if (!data || typeof data.progressUrl !== 'string' || !/^https:\/\//.test(data.progressUrl)) return null;
  return { url: data.progressUrl, offset: Number(data.offset) > 0 ? Number(data.offset) : 0, durationSec: Number(data.durationSec) > 0 ? Number(data.durationSec) : 0 };
}

export class ProgressSaver {
  /** @param send posts the body to the address; failures are left for the next save. */
  constructor(send, now = () => Date.now()) {
    this.send = send;
    this.now = now;
    this.item = null;
  }

  /**
   * A new title on the TV (null: one that is not saved), asked to start `startAt` seconds into its
   * stream (the resume point).
   */
  start(target, startAt = 0) {
    this.item = target ? { ...target, played: false, savedAt: 0, startAt: Number(startAt) > 0 ? Number(startAt) : 0 } : null;
  }

  /**
   * While it plays: saved every SAVE_EVERY_MS. Only once the TV got to where it was asked to start:
   * playing from the beginning first would otherwise overwrite the resume point with a few seconds.
   */
  tick(time, duration) {
    if (!this.item) return;
    if (!this.item.played && Number.isFinite(time) && time + START_SLACK_SEC < this.item.startAt) return;
    this.item.played = true;
    if (this.now() - this.item.savedAt >= SAVE_EVERY_MS) this.save(time, duration);
  }

  /** Paused or stopped: saved now (only once it has played, so a title that never started keeps its resume point). */
  save(time, duration, ended = false) {
    const item = this.item;
    if (!item || !item.played) return;
    const body = progressReport(item, time, duration, ended);
    if (!body) return;
    item.savedAt = this.now();
    Promise.resolve()
      .then(() => this.send(item.url, body))
      .catch(() => undefined);
  }

  /** The title is done on the TV (to the end, stopped, or replaced by another). */
  finish(time, duration, ended = false) {
    this.save(time, duration, ended);
    this.item = null;
  }
}
