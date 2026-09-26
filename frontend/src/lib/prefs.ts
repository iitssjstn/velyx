import { useSyncExternalStore } from 'react';

/** Per-browser playback preferences. Stored in localStorage (never credentials). */
export type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = 'white' | 'yellow';
export type SubtitleBackground = 'none' | 'translucent' | 'solid';
export type SubtitleEdge = 'shadow' | 'outline' | 'none';

export interface PlaybackPrefs {
  autoplayNext: boolean;
  autoplayCountdown: number;
  subtitleLanguage: string; // '' = off, otherwise ISO code like 'en' / 'nl'
  /** The last chosen subtitle was a forced track (foreign-language parts only). */
  subtitleForced: boolean;
  /** Fallback for tracks without a language tag: the label of the last chosen subtitle. */
  subtitleLabel: string;
  subtitleSize: SubtitleSize;
  subtitleColor: SubtitleColor;
  subtitleBackground: SubtitleBackground;
  subtitleEdge: SubtitleEdge;
  /** Extra distance from the bottom, in percent of the player height (0–20). */
  subtitlePosition: number;
  audioLanguage: string;
  /** Converted audio: stereo downmix or keep up to 5.1 surround. */
  audioOutput: 'stereo' | 'surround';
  boostVoices: boolean;
  levelVolume: boolean;
  showCompatibilityWarnings: boolean;
  volume: number;
  muted: boolean;
}

export const DEFAULT_PREFS: PlaybackPrefs = {
  autoplayNext: true,
  autoplayCountdown: 10,
  subtitleLanguage: '',
  subtitleForced: false,
  subtitleLabel: '',
  subtitleSize: 'medium',
  subtitleColor: 'white',
  subtitleBackground: 'none',
  subtitleEdge: 'shadow',
  subtitlePosition: 0,
  audioLanguage: '',
  audioOutput: 'stereo',
  boostVoices: false,
  levelVolume: false,
  showCompatibilityWarnings: true,
  volume: 1,
  muted: false,
};

const KEY = 'velyx.playback';
const listeners = new Set<() => void>();
let current: PlaybackPrefs = load();

function load(): PlaybackPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PlaybackPrefs>) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function getPrefs(): PlaybackPrefs {
  return current;
}

export function setPrefs(patch: Partial<PlaybackPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be unavailable (private mode) — keep in memory */
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): PlaybackPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const SUBTITLE_SIZES: Record<SubtitleSize, string> = {
  small: 'clamp(0.95rem, 1.8vw, 1.35rem)',
  medium: 'clamp(1.1rem, 2.4vw, 1.8rem)',
  large: 'clamp(1.3rem, 3vw, 2.3rem)',
  xlarge: 'clamp(1.5rem, 3.8vw, 2.9rem)',
};

/** Normalises ISO 639-1/-2 codes so "eng", "en" and "en-US" compare equal. */
const ISO_639_2: Record<string, string> = { eng: 'en', dut: 'nl', nld: 'nl', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', swe: 'sv', nor: 'no', nob: 'no', dan: 'da', fin: 'fi', pol: 'pl', rus: 'ru', tur: 'tr', ara: 'ar' };

/** "eng", "en-US" and "EN" all become "en"; unknown codes are kept (lower-cased). */
export function normalizeLanguage(code: string | null | undefined): string {
  if (!code) return '';
  const base = code.toLowerCase().split(/[-_]/)[0] ?? '';
  return ISO_639_2[base] ?? base;
}

export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeLanguage(a) === normalizeLanguage(b);
}
