import * as SecureStore from 'expo-secure-store';
import type { SubtitleChoice } from './subtitles';

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
