import { describe, expect, it } from 'vitest';
import { FAST_STEP, MENU_LINE, initialTvState, menuRows, pressKey, remoteKey, segmentMarks, tvButtons, tvTabs, visibleLines, type TvContext, type TvState } from './tvRemote';

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
    expect(tvTabs()).toEqual(['subtitles', 'style']);
    expect(tvTabs({ audioTracks: 3 })).toEqual(['subtitles', 'style', 'audio']);
    // Searching online sits right after the style, when the server can search.
    expect(tvTabs({ audioTracks: 3, online: true })).toEqual(['subtitles', 'style', 'online', 'audio']);
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

  it('hides the controls with ↓ while they show', () => {
    const r = pressKey(initialTvState(), 'down', ctx());
    expect(r.state.open).toBe('bar');
    expect(pressKey(r.state, 'down', ctx())).toMatchObject({ handled: true, state: { open: 'none' } });
  });

  it('reaches the Back button with ↑ from any button and comes back to the same button with ↓', () => {
    let r = pressKey(initialTvState(), 'down', ctx());
    r = pressKey(r.state, 'right', ctx());
    r = pressKey(r.state, 'right', ctx());
    expect(r.state).toMatchObject({ open: 'bar', top: false, focus: 3 });
    r = pressKey(r.state, 'up', ctx());
    expect(r).toMatchObject({ handled: true, action: { type: 'show' }, state: { open: 'bar', top: true } });
    expect(pressKey(r.state, 'ok', ctx()).action).toEqual({ type: 'exit' });
    expect(pressKey(r.state, 'down', ctx()).state).toMatchObject({ open: 'bar', top: false, focus: 3 });
    // ↑ again hides the controls.
    expect(pressKey(r.state, 'up', ctx()).state).toMatchObject({ open: 'none', top: false });
  });

  it('reaches the Back button at the top left with ← from the first button and leaves the player with OK', () => {
    let r = pressKey(initialTvState(), 'up', ctx());
    r = pressKey(r.state, 'left', ctx());
    expect(r.state).toMatchObject({ open: 'bar', top: false, focus: 0 });
    r = pressKey(r.state, 'left', ctx());
    expect(r.state).toMatchObject({ open: 'bar', top: true });
    expect(pressKey(r.state, 'ok', ctx()).action).toEqual({ type: 'exit' });
    // ← stays there; → and ↓ go back to the row; ↑ hides the controls.
    expect(pressKey(r.state, 'left', ctx()).state).toMatchObject({ top: true });
    expect(pressKey(r.state, 'right', ctx()).state).toMatchObject({ open: 'bar', top: false, focus: 0 });
    expect(pressKey(r.state, 'up', ctx()).state).toMatchObject({ open: 'none', top: false });
    const down = pressKey(r.state, 'down', ctx());
    expect(down.state).toMatchObject({ open: 'bar', top: false, focus: 0 });
    // Back closes everything; the row opens on play again, not on the Back button.
    const closed = pressKey(r.state, 'back', ctx());
    expect(closed).toMatchObject({ handled: true, state: { open: 'none', top: false } });
    expect(pressKey(closed.state, 'down', ctx()).state).toMatchObject({ open: 'bar', top: false, focus: 1 });
  });

  it('opens the menu on the chosen subtitle, switches tabs and picks a line', () => {
    let r = pressKey({ ...initialTvState(), open: 'bar', focus: 3 }, 'ok', ctx());
    expect(r.state).toMatchObject({ open: 'menu', tab: 'subtitles', item: 1 });
    r = pressKey(r.state, 'down', ctx());
    r = pressKey(r.state, 'down', ctx());
    expect(r.state.item).toBe(2);
    expect(pressKey(r.state, 'ok', ctx())).toMatchObject({ action: { type: 'pick', tab: 'subtitles', index: 2 }, state: { open: 'none' } });
    r = pressKey(r.state, 'right', ctx());
    expect(r.state).toMatchObject({ tab: 'style', item: 0 });
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

describe('the menu on a TV screen', () => {
  it('shows only as many lines as fit, so the focused line is never off the screen', () => {
    // A Chromecast with Google TV is 540 high: nine lines did not fit.
    expect(menuRows(540)).toBeLessThan(9);
    expect(menuRows(540) * MENU_LINE + 130).toBeLessThanOrEqual(540);
    expect(menuRows(1080)).toBeGreaterThan(menuRows(540));
    expect(menuRows(200)).toBe(3);
  });

  it('scrolls the lines along with the focus and says when there is more', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const first = visibleLines(lines, 0, 7);
    expect(first.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(first[0]!.more).toEqual({ above: false, below: true });
    const last = visibleLines(lines, 19, 7);
    expect(last.map((l) => l.index)).toContain(19);
    expect(last[0]!.more).toEqual({ above: true, below: false });
    const middle = visibleLines(lines, 10, 7);
    expect(middle.map((l) => l.index)).toContain(10);
    expect(visibleLines(['a', 'b'], 1, 7).map((l) => l.text)).toEqual(['a', 'b']);
  });
});

describe('the Style tab', () => {
  it('sits right next to the subtitles and stays open after a change', () => {
    const c = ctx({ items: { subtitles: 3, style: 5, audio: 2 } });
    let s: TvState = { ...initialTvState(), open: 'menu', tab: 'subtitles' };
    s = pressKey(s, 'right', c).state;
    expect(s.tab).toBe('style');
    s = pressKey(s, 'down', c).state;
    const r = pressKey(s, 'ok', c);
    expect(r.action).toEqual({ type: 'pick', tab: 'style', index: 1 });
    expect(r.state.open).toBe('menu');
    // A subtitle chosen still closes the menu.
    const back = pressKey({ ...r.state, tab: 'subtitles', item: 0 }, 'ok', c);
    expect(back.state.open).toBe('none');
  });
});

describe('searching online on the TV', () => {
  const c = ctx({ tabs: tvTabs({ audioTracks: 2, online: true }), items: { subtitles: 3, online: 4, audio: 2 }, stays: (tab, index) => tab === 'online' && index === 0 });
  it('keeps the menu open on the language line, and closes it when a subtitle is picked', () => {
    const open: TvState = { ...initialTvState(), open: 'menu', tab: 'online', item: 0 };
    const language = pressKey(open, 'ok', c);
    expect(language.action).toEqual({ type: 'pick', tab: 'online', index: 0 });
    expect(language.state.open).toBe('menu');
    const pick = pressKey({ ...open, item: 2 }, 'ok', c);
    expect(pick.action).toEqual({ type: 'pick', tab: 'online', index: 2 });
    expect(pick.state.open).toBe('none');
  });
  it('reaches the tab from the style with →', () => {
    const r = pressKey({ ...initialTvState(), open: 'menu', tab: 'style', item: 0 }, 'right', c);
    expect(r.state.tab).toBe('online');
  });
});

describe('the question at the start', () => {
  const c = ctx({ resumeAsk: true });
  it('resumes with OK, or starts over after →', () => {
    expect(pressKey(initialTvState(), 'ok', c).action).toEqual({ type: 'resume', fromStart: false });
    const r = pressKey(initialTvState(), 'right', c);
    expect(r.state.resumeFocus).toBe(1);
    expect(pressKey(r.state, 'ok', c).action).toEqual({ type: 'resume', fromStart: true });
    expect(pressKey(r.state, 'left', c).state.resumeFocus).toBe(0);
  });
  it('leaves Back to the app (it closes the player), and play resumes', () => {
    expect(pressKey(initialTvState(), 'back', c).handled).toBe(false);
    expect(pressKey(initialTvState(), 'playpause', c).action).toEqual({ type: 'resume', fromStart: false });
  });
  it('does not open the bar while it is up', () => {
    expect(pressKey(initialTvState(), 'down', c).state.open).toBe('none');
  });
});
