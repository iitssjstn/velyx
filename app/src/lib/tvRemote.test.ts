import { describe, expect, it } from 'vitest';
import { FAST_STEP, initialTvState, pressKey, remoteKey, segmentMarks, tvButtons, tvTabs, type TvContext } from './tvRemote';

const ctx = (over: Partial<TvContext> = {}): TvContext => ({
  buttons: tvButtons({ audioTracks: 2, hasNext: true }),
  tabs: tvTabs({ audioTracks: 2 }),
  items: { subtitles: 3, audio: 2 },
  selected: { subtitles: 1, audio: 0 },
  skip: false,
  upNext: false,
  ...over,
});

describe('remoteKey', () => {
  it('reads the arrows, OK, media keys and Back of an Android TV remote', () => {
    expect([21, 22, 19, 20].map(remoteKey)).toEqual(['left', 'right', 'up', 'down']);
    expect([23, 66, 160].map(remoteKey)).toEqual(['ok', 'ok', 'ok']);
    expect([85, 126, 127].map(remoteKey)).toEqual(['playpause', 'playpause', 'playpause']);
    expect([90, 89, 4].map(remoteKey)).toEqual(['forward', 'rewind', 'back']);
    expect(remoteKey(24)).toBeNull();
  });
});

describe('buttons and tabs', () => {
  it('only offers audio with a choice and the next episode when there is one', () => {
    expect(tvButtons()).toEqual(['back', 'play', 'forward', 'subtitles']);
    expect(tvButtons({ audioTracks: 2, hasNext: true })).toEqual(['back', 'play', 'forward', 'subtitles', 'audio', 'next']);
    expect(tvTabs()).toEqual(['subtitles']);
    expect(tvTabs({ audioTracks: 3 })).toEqual(['subtitles', 'audio']);
  });
});

describe('pressKey', () => {
  it('plays/pauses with OK and jumps with ←/→ when nothing is open', () => {
    const s = initialTvState();
    expect(pressKey(s, 'ok', ctx()).action).toEqual({ type: 'toggle' });
    expect(pressKey(s, 'left', ctx()).action).toEqual({ type: 'step', side: 'back' });
    expect(pressKey(s, 'right', ctx()).action).toEqual({ type: 'step', side: 'forward' });
    expect(pressKey(s, 'forward', ctx()).action).toEqual({ type: 'seek', by: FAST_STEP });
    expect(pressKey(s, 'rewind', ctx()).action).toEqual({ type: 'seek', by: -FAST_STEP });
  });

  it('skips the intro with OK while the skip is offered', () => {
    expect(pressKey(initialTvState(), 'ok', ctx({ skip: true })).action).toEqual({ type: 'skip' });
  });

  it('leaves an unused Back to the app (it leaves the player)', () => {
    expect(pressKey(initialTvState(), 'back', ctx()).handled).toBe(false);
  });

  it('opens the row on the play button and moves along it', () => {
    let r = pressKey(initialTvState(), 'up', ctx());
    expect(r.state).toMatchObject({ open: 'bar', focus: 1 });
    r = pressKey(r.state, 'right', ctx());
    r = pressKey(r.state, 'ok', ctx());
    expect(r.action).toEqual({ type: 'step', side: 'forward' });
    r = pressKey(r.state, 'left', ctx());
    expect(pressKey(r.state, 'ok', ctx()).action).toEqual({ type: 'toggle' });
    // Not past the ends.
    for (let i = 0; i < 9; i++) r = pressKey(r.state, 'right', ctx());
    expect(r.state.focus).toBe(5);
    expect(pressKey(r.state, 'ok', ctx()).action).toEqual({ type: 'next' });
    // Back closes the row and is used.
    const back = pressKey(r.state, 'back', ctx());
    expect(back).toMatchObject({ handled: true, state: { open: 'none' } });
  });

  it('opens the menu on the chosen subtitle, switches tabs and picks a line', () => {
    let r = pressKey({ ...initialTvState(), open: 'bar', focus: 3 }, 'ok', ctx());
    expect(r.state).toMatchObject({ open: 'menu', tab: 'subtitles', item: 1 });
    r = pressKey(r.state, 'down', ctx());
    r = pressKey(r.state, 'down', ctx());
    expect(r.state.item).toBe(2);
    expect(pressKey(r.state, 'ok', ctx())).toMatchObject({ action: { type: 'pick', tab: 'subtitles', index: 2 }, state: { open: 'none' } });
    r = pressKey(r.state, 'right', ctx());
    expect(r.state).toMatchObject({ tab: 'audio', item: 0 });
    expect(pressKey(r.state, 'back', ctx()).state.open).toBe('bar');
  });

  it('works the "Next episode" card: ←/→ choose, OK does it, Back dismisses', () => {
    const up = ctx({ upNext: true });
    expect(pressKey(initialTvState(), 'ok', up).action).toEqual({ type: 'next' });
    const right = pressKey(initialTvState(), 'right', up);
    expect(right.state.nextFocus).toBe(1);
    expect(pressKey(right.state, 'ok', up).action).toEqual({ type: 'dismissNext' });
    expect(pressKey(initialTvState(), 'back', up)).toMatchObject({ handled: true, action: { type: 'dismissNext' } });
  });
});

describe('segmentMarks', () => {
  const span = (start: number, end: number) => ({ start, end, confidence: 'high' as const });
  it('marks the start and end of each part on the bar', () => {
    expect(segmentMarks({ fileId: 7, recap: span(0, 30), intro: span(60, 90), credits: span(2400, 2500), postCredits: null }, 7, 2500)).toEqual([0.012, 0.024, 0.036, 0.96]);
  });
  it('marks nothing for another file or without a length', () => {
    const segments = { fileId: 8, intro: span(60, 90), credits: null, postCredits: null };
    expect(segmentMarks(segments, 7, 2500)).toEqual([]);
    expect(segmentMarks({ ...segments, fileId: 7 }, 7, 0)).toEqual([]);
  });
});
