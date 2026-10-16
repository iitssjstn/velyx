export const SAVE_EVERY_MS: number;
export const START_SLACK_SEC: number;
export interface ProgressItem { url: string; offset: number; durationSec: number }
export function progressReport(item: ProgressItem, time: number, duration: number, ended?: boolean): { positionSec: number; durationSec: number } | null;
export function progressTarget(customData: unknown): ProgressItem | null;
export class ProgressSaver {
  constructor(send: (url: string, body: { positionSec: number; durationSec: number }) => unknown, now?: () => number);
  start(target: ProgressItem | null, startAt?: number): void;
  tick(time: number, duration: number): void;
  save(time: number, duration: number, ended?: boolean): void;
  finish(time: number, duration: number, ended?: boolean): void;
}
