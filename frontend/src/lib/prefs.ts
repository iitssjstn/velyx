import { useSyncExternalStore } from 'react';

/** Per-browser playback preferences. Stored in localStorage (never credentials). */
export interface PlaybackPrefs {
  autoplayNext: boolean;
  autoplayCountdown: number;
  subtitleLanguage: string; // '' = off, otherwise ISO code like 'en' / 'nl'
  subtitleSize: 'small' | 'medium' | 'large';
  audioLanguage: string;
  showCompatibilityWarnings: boolean;
  volume: number;
  muted: boolean;
}

export const DEFAULT_PREFS: PlaybackPrefs = {
  autoplayNext: true,
  autoplayCountdown: 10,
  subtitleLanguage: '',
  subtitleSize: 'medium',
  audioLanguage: '',
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

export const SUBTITLE_SIZES: Record<PlaybackPrefs['subtitleSize'], string> = {
  small: 'clamp(0.9rem, 1.6vw, 1.2rem)',
  medium: 'clamp(1.05rem, 2.2vw, 1.6rem)',
  large: 'clamp(1.25rem, 3vw, 2.2rem)',
};

/** Normalises ISO 639-1/-2 codes so "eng", "en" and "en-US" compare equal. */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (x: string) => {
    const base = x.toLowerCase().split(/[-_]/)[0];
    const map: Record<string, string> = { eng: 'en', dut: 'nl', nld: 'nl', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', swe: 'sv', nor: 'no', nob: 'no', dan: 'da', fin: 'fi', pol: 'pl', rus: 'ru', tur: 'tr', ara: 'ar' };
    return map[base] ?? base;
  };
  return norm(a) === norm(b);
}
