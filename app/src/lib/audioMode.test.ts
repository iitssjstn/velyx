import { describe, expect, it } from 'vitest';
import { audioMenuPick, isAudioMode } from './audioMode';

describe('audio mode', () => {
  it('knows the three modes', () => {
    expect(isAudioMode('night')).toBe(true);
    expect(isAudioMode('loud')).toBe(false);
    expect(isAudioMode(null)).toBe(false);
  });

  it('maps a line of the TV audio menu to a track or a mode', () => {
    expect(audioMenuPick(0, 2)).toEqual({ kind: 'track', index: 0 });
    expect(audioMenuPick(1, 2)).toEqual({ kind: 'track', index: 1 });
    expect(audioMenuPick(2, 2)).toEqual({ kind: 'mode', mode: 'normal' });
    expect(audioMenuPick(4, 2)).toEqual({ kind: 'mode', mode: 'night' });
    expect(audioMenuPick(5, 2)).toBeNull();
    // One track: only the modes are a choice.
    expect(audioMenuPick(1, 1)).toEqual({ kind: 'mode', mode: 'normal' });
  });
});
