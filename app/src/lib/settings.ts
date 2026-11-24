import { SEEK_STEPS, type SkipMode } from './skip';
import { AUDIO_MODES, type AudioMode } from './audioMode';
import { languageName } from './onlineSubtitles';

/**
 * The settings of Account → Playback, the same as on the website. The language and skip settings
 * belong to the account (the server keeps them, every device uses them); autoplay, the countdown,
 * the seek step (kept apart, see remember.ts) and surround sound belong to this device, as they do in a browser.
 */

/** The languages to choose from for audio and subtitles (as on the website). */
export const MEDIA_LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'sv', 'da', 'no', 'fi', 'pl', 'tr', 'ja', 'ko', 'zh'] as const;

export type SubtitleMode = 'remember' | 'always' | 'foreign' | 'forced' | 'off';
export const SUBTITLE_MODES: SubtitleMode[] = ['remember', 'always', 'foreign', 'forced', 'off'];
export const SKIP_MODES: SkipMode[] = ['ask', 'always', 'never'];
export const COUNTDOWNS = [5, 10, 15, 20, 30] as const;

/** What the server keeps for the account (GET/PUT /api/account/preferences). */
export interface AccountPrefs {
  audioLanguage: string | null;
  subtitleMode: SubtitleMode;
  subtitleLanguage: string | null;
  subtitleFallback: string | null;
  skipIntro?: SkipMode;
  skipCredits?: SkipMode;
  skipRecap?: SkipMode;
  audioMode?: AudioMode;
}

/** One choice: its value and what is shown for it. */
export interface Choice<T extends string> {
  value: T;
  label: string;
}

/**
 * The language choices: the empty value first ("Original" / "None"), then the list, and a language
 * the account already has that is not on the list, so it is shown and kept.
 */
export function languageChoices(current: string | null | undefined, emptyLabel: string, appLanguage: string): Choice<string>[] {
  const codes: string[] = [...MEDIA_LANGUAGES];
  if (current && !codes.includes(current)) codes.push(current);
  return [{ value: '', label: emptyLabel }, ...codes.map((c) => ({ value: c, label: languageName(c, appLanguage) }))];
}

/** Which language settings can be changed, given how subtitles are shown (as on the website). */
export function subtitleFields(mode: SubtitleMode): { language: boolean; fallback: boolean; needsLanguage: boolean } {
  const needsLanguage = mode === 'always' || mode === 'foreign';
  return { language: mode !== 'off' && mode !== 'remember', fallback: needsLanguage, needsLanguage };
}

/** The recap setting follows the intro setting until it is set itself (as on the website). */
export function skipModes(p: Pick<AccountPrefs, 'skipIntro' | 'skipCredits' | 'skipRecap'> | null | undefined): { recap: SkipMode; intro: SkipMode; credits: SkipMode } {
  const intro = p?.skipIntro ?? 'ask';
  return { recap: p?.skipRecap ?? intro, intro, credits: p?.skipCredits ?? 'ask' };
}

/** The playback settings kept on this device. */
export interface DevicePrefs {
  /** Start the next episode by itself, after the countdown. */
  autoplayNext: boolean;
  countdown: (typeof COUNTDOWNS)[number];
  /** Surround sound (5.1) when the server converts the audio; stereo otherwise. */
  surround: boolean;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = { autoplayNext: true, countdown: 10, surround: false };

/** What was stored, checked: anything unknown or missing falls back to the default. */
export function readDevicePrefs(raw: unknown): DevicePrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    autoplayNext: typeof o.autoplayNext === 'boolean' ? o.autoplayNext : DEFAULT_DEVICE_PREFS.autoplayNext,
    countdown: (COUNTDOWNS as readonly unknown[]).includes(o.countdown) ? (o.countdown as DevicePrefs['countdown']) : DEFAULT_DEVICE_PREFS.countdown,
    surround: o.surround === true,
  };
}

/** The countdown before the next episode starts, or null when it does not start by itself. */
export function nextCountdown(p: Pick<DevicePrefs, 'autoplayNext' | 'countdown'>): number | null {
  return p.autoplayNext ? p.countdown : null;
}

export { SEEK_STEPS, AUDIO_MODES };
