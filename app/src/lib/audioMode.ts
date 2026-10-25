/** How audio is processed (stored with the account, on every device): voices boosted, or night (also loud scenes softer). */
export type AudioMode = 'normal' | 'voices' | 'night';
export const AUDIO_MODES: AudioMode[] = ['normal', 'voices', 'night'];

export function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === 'string' && (AUDIO_MODES as string[]).includes(value);
}

/**
 * A line of the TV player's audio menu: first the file's audio tracks, then the three audio modes.
 */
export function audioMenuPick(index: number, tracks: number): { kind: 'track'; index: number } | { kind: 'mode'; mode: AudioMode } | null {
  if (index < 0) return null;
  if (index < tracks) return { kind: 'track', index };
  const mode = AUDIO_MODES[index - tracks];
  return mode ? { kind: 'mode', mode } : null;
}
