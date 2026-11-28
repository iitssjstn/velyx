import { describe, expect, it } from 'vitest';
import { nextSwitch, showsPlainSpinner, switchLabel } from './streamSwitch';

describe('loading note while the stream changes', () => {
  it('shows from the start and goes when the new stream is ready', () => {
    let s = nextSwitch(null, { type: 'start', reason: 'voices' });
    expect(s).toEqual({ reason: 'voices', loading: false });
    // The old stream still says it is ready: the note stays.
    s = nextSwitch(s, { type: 'ready' });
    expect(s).not.toBeNull();
    s = nextSwitch(s, { type: 'loading' });
    s = nextSwitch(s, { type: 'ready' });
    expect(s).toBeNull();
  });

  it('goes at once when nothing new had to load, or when it failed', () => {
    const s = nextSwitch(null, { type: 'start', reason: 'audio' });
    expect(nextSwitch(s, { type: 'done' })).toBeNull();
    expect(nextSwitch(s, { type: 'failed' })).toBeNull();
  });

  it('does nothing when no change is going on', () => {
    expect(nextSwitch(null, { type: 'loading' })).toBeNull();
    expect(nextSwitch(null, { type: 'ready' })).toBeNull();
  });

  it('says what it does', () => {
    expect(switchLabel('voices')).toBe('player.switching.voices');
    expect(switchLabel('seek')).toBe('player.switching.seek');
  });

  it('shows only one loading circle while a note is up', () => {
    const s = nextSwitch(null, { type: 'start', reason: 'audio' });
    expect(showsPlainSpinner(true, s)).toBe(false);
    expect(showsPlainSpinner(true, true)).toBe(false);
    expect(showsPlainSpinner(true, null)).toBe(true);
    expect(showsPlainSpinner(true, false)).toBe(true);
    expect(showsPlainSpinner(false, null)).toBe(false);
  });
});
