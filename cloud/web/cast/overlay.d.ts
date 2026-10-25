export const SHOW_FOR_MS: number;
export function formatTime(sec: number): string;
export function fileTimes(target: { offset: number; durationSec: number } | null, time: number, duration: number): { position: number; length: number };
export function barVisible(state: string | null | undefined, shownAt: number, now: number): boolean;
export function cssColor(value: unknown): string | null;
export function cueCss(style: unknown): string;
export const SUBTITLE_LOADING_AFTER_MS: number;
export const SUBTITLE_ERROR_FOR_MS: number;
export class SubtitleLoad {
  constructor(get: (url: string) => Promise<boolean> | boolean, clock?: () => number);
  watch(url: string | null): void;
  shown(): 'loading' | 'error' | null;
}
export function ccLabel(track: { name?: string | null; language?: string | null } | null): string;
