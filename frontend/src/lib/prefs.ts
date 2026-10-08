import { useSyncExternalStore } from 'react';
import { api } from './api';

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
  /** Use the TV preset instead of the custom size, colour, background and edge. */
  castSubtitleDefaults: boolean;
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
  /** Seconds the back/forward buttons and ← → jump. */
  seekStep: SeekStep;
}

export const SEEK_STEPS = [5, 10, 15, 30] as const;
export type SeekStep = (typeof SEEK_STEPS)[number];

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
  castSubtitleDefaults: true,
  subtitlePosition: 0,
  audioLanguage: '',
  audioOutput: 'stereo',
  boostVoices: false,
  levelVolume: false,
  showCompatibilityWarnings: true,
  volume: 1,
  muted: false,
  seekStep: 10,
};

const KEY = 'velyx.playback';
const listeners = new Set<() => void>();
let current: PlaybackPrefs = load();
let accountGeneration = 0;
let accountActive = false;
let styleRevision = 0;
let pendingSave = Promise.resolve();

export const CAST_SUBTITLE_DEFAULTS = { subtitleSize: 'medium', subtitleColor: 'white', subtitleBackground: 'translucent', subtitleEdge: 'outline' } as const;

export function readSubtitlePrefs(raw: Partial<PlaybackPrefs>): Pick<PlaybackPrefs, 'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitleEdge' | 'subtitlePosition' | 'castSubtitleDefaults'> {
  return {
    subtitleSize: ['small', 'medium', 'large', 'xlarge'].includes(raw.subtitleSize ?? '') ? raw.subtitleSize! : 'medium',
    subtitleColor: raw.subtitleColor === 'yellow' ? 'yellow' : 'white',
    subtitleBackground: ['none', 'translucent', 'solid'].includes(raw.subtitleBackground ?? '') ? raw.subtitleBackground! : 'none',
    subtitleEdge: ['shadow', 'outline', 'none'].includes(raw.subtitleEdge ?? '') ? raw.subtitleEdge! : 'shadow',
    subtitlePosition: typeof raw.subtitlePosition === 'number' && Number.isFinite(raw.subtitlePosition) ? Math.max(0, Math.min(20, Math.round(raw.subtitlePosition / 5) * 5)) : 0,
    castSubtitleDefaults: typeof raw.castSubtitleDefaults === 'boolean' ? raw.castSubtitleDefaults : !['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleEdge'].some((key) => key in raw),
  };
}

type AccountSubtitleStyle = { size: SubtitleSize; color: SubtitleColor; background: SubtitleBackground; edge: SubtitleEdge; position: number; castDefaults?: boolean };

/** Account style wins on sign-in; edits made while it loads win over that older response. */
export function syncSubtitlePrefs(): () => void {
  const generation = ++accountGeneration;
  const revision = styleRevision;
  accountActive = true;
  void api.get<{ subtitleStyle?: AccountSubtitleStyle | null }>('/api/account/preferences').then(({ subtitleStyle: s }) => {
    if (!s || generation !== accountGeneration || revision !== styleRevision) return;
    current = { ...current, ...readSubtitlePrefs({ subtitleSize: s.size, subtitleColor: s.color, subtitleBackground: s.background, subtitleEdge: s.edge, subtitlePosition: s.position, castSubtitleDefaults: s.castDefaults ?? false }) };
    persist();
  }).catch(() => undefined);
  return () => {
    if (generation === accountGeneration) {
      accountActive = false;
      ++accountGeneration;
    }
  };
}

function load(): PlaybackPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Partial<PlaybackPrefs> : {};
    return { ...DEFAULT_PREFS, ...saved, ...readSubtitlePrefs(saved) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function getPrefs(): PlaybackPrefs {
  return current;
}

export function setPrefs(patch: Partial<PlaybackPrefs>): void {
  current = { ...current, ...patch };
  const styleChanged = ['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleEdge', 'subtitlePosition', 'castSubtitleDefaults'].some((key) => key in patch);
  if (styleChanged) {
    ++styleRevision;
    // Editing a custom appearance explicitly opts out of the TV preset.
    if (patch.castSubtitleDefaults === undefined && ['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleEdge'].some((key) => key in patch)) current.castSubtitleDefaults = false;
    current = { ...current, ...readSubtitlePrefs(current) };
    if (accountActive) {
      const generation = accountGeneration;
      const subtitleStyle: AccountSubtitleStyle = { size: current.subtitleSize, color: current.subtitleColor, background: current.subtitleBackground, edge: current.subtitleEdge, position: current.subtitlePosition, castDefaults: current.castSubtitleDefaults };
      pendingSave = pendingSave.then(async () => {
        if (accountActive && generation === accountGeneration) await api.put('/api/account/preferences', { subtitleStyle });
      }).catch(() => undefined);
    }
  }
  persist();
}

function persist(): void {
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
