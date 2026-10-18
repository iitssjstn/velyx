export const SHOW_FOR_MS: number;
export function formatTime(sec: number): string;
export function fileTimes(target: { offset: number; durationSec: number } | null, time: number, duration: number): { position: number; length: number };
export function barVisible(state: string | null | undefined, shownAt: number, now: number): boolean;
export function cssColor(value: unknown): string | null;
export function cueCss(style: unknown): string;
