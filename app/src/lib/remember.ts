import * as SecureStore from 'expo-secure-store';
import type { SubtitleChoice } from './subtitles';
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
