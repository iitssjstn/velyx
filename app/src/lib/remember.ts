import * as SecureStore from 'expo-secure-store';
import type { SubtitleChoice } from './subtitles';
import { readSeekStep, type SeekStep } from './skip';
import { readDevicePrefs, type DevicePrefs } from './settings';
import { DEFAULT_SUBTITLE_STYLE, readSubtitleStyle, type SubtitleStyle } from './subtitleStyle';

const KEY = 'velyx.subtitleChoice';

/** The last subtitle choice on this device, for the "remember your last choice" setting. */
export async function rememberedSubtitle(): Promise<SubtitleChoice | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as SubtitleChoice) : null;
  } catch {
    return null;
  }
}

export async function rememberSubtitle(choice: SubtitleChoice): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(choice));
  } catch {
    /* not remembered this time */
  }
}

const STYLE_KEY = 'velyx.subtitleStyle';

/** How subtitles look on this device. */
export async function storedSubtitleStyle(): Promise<SubtitleStyle> {
  try {
    const raw = await SecureStore.getItemAsync(STYLE_KEY);
    return readSubtitleStyle(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

export async function storeSubtitleStyle(style: SubtitleStyle): Promise<void> {
  try {
    await SecureStore.setItemAsync(STYLE_KEY, JSON.stringify(style));
  } catch {
    /* kept for this playback only */
  }
}

const SEEK_KEY = 'velyx.seekStep';

/** How far back/forward jumps on this device. */
export async function storedSeekStep(): Promise<SeekStep> {
  try {
    return readSeekStep(Number(await SecureStore.getItemAsync(SEEK_KEY)));
  } catch {
    return 10;
  }
}

export async function storeSeekStep(step: SeekStep): Promise<void> {
  try {
    await SecureStore.setItemAsync(SEEK_KEY, String(step));
  } catch {
    /* kept for this session only */
  }
}

const AUDIO_KEY = 'velyx.audioLanguage';

/** The language of the audio track last chosen on this device (the next episode starts in it). */
export async function rememberedAudio(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(AUDIO_KEY)) || null;
  } catch {
    return null;
  }
}

export async function rememberAudio(language: string | null | undefined): Promise<void> {
  if (!language) return;
  try {
    await SecureStore.setItemAsync(AUDIO_KEY, language);
  } catch {
    /* not remembered this time */
  }
}

/** The audio language chosen in Account wins over the track last chosen in the player. */
export async function forgetAudio(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUDIO_KEY);
  } catch {
    /* nothing remembered */
  }
}

const DEVICE_KEY = 'velyx.devicePrefs';

/** Autoplay, the countdown and surround sound on this device. */
export async function storedDevicePrefs(): Promise<DevicePrefs> {
  try {
    const raw = await SecureStore.getItemAsync(DEVICE_KEY);
    return readDevicePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return readDevicePrefs(null);
  }
}

export async function storeDevicePrefs(prefs: DevicePrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(prefs));
  } catch {
    /* kept until the app closes */
  }
}
