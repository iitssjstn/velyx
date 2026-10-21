/**
 * The player on Android TV / Google TV, operated with the remote: which key does what and what is on
 * screen. The same choices as Vidalune's cast player on the TV (cloud/web/cast/remote.js), so both
 * feel alike: OK plays/pauses (or skips the intro when offered), ←/→ jump, ↑/↓ bring up the row of
 * buttons, Back closes what is open and then leaves the player.
 */

import type { EpisodeSegments } from './skip';

export type RemoteKey = 'left' | 'right' | 'up' | 'down' | 'ok' | 'playpause' | 'forward' | 'rewind' | 'back';

/** Android's key codes (KeyEvent.KEYCODE_*) as what they mean on a remote; null for others. */
export function remoteKey(keyCode: number): RemoteKey | null {
  switch (keyCode) {
    case 21:
      return 'left';
    case 22:
      return 'right';
    case 19:
      return 'up';
    case 20:
      return 'down';
    case 23: // DPAD_CENTER
    case 66: // ENTER
    case 160: // NUMPAD_ENTER
      return 'ok';
    case 85: // MEDIA_PLAY_PAUSE
    case 126: // MEDIA_PLAY
    case 127: // MEDIA_PAUSE
      return 'playpause';
    case 90:
      return 'forward';
    case 89:
      return 'rewind';
    case 4:
      return 'back';
    default:
      return null;
  }
}

/** How far the fast-forward and rewind keys jump (←/→ use the player's own step). */
export const FAST_STEP = 30;
/** How long the controls stay up without a key while playing. */
export const TV_CONTROLS_MS = 6000;

export type TvButton = 'back' | 'play' | 'forward' | 'subtitles' | 'audio' | 'next';
export type TvTab = 'subtitles' | 'audio';

/** The buttons in the row, in order: only those that do something for this title. */
export function tvButtons({ audioTracks = 0, hasNext = false }: { audioTracks?: number; hasNext?: boolean } = {}): TvButton[] {
  return ['back', 'play', 'forward', 'subtitles', ...(audioTracks > 1 ? (['audio'] as const) : []), ...(hasNext ? (['next'] as const) : [])];
}

/** The menu's tabs: audio only when there is a choice. */
export function tvTabs({ audioTracks = 0 }: { audioTracks?: number } = {}): TvTab[] {
  return ['subtitles', ...(audioTracks > 1 ? (['audio'] as const) : [])];
}

export interface TvState {
  /** Nothing on screen, the row of buttons, or the menu (subtitles / audio). */
  open: 'none' | 'bar' | 'menu';
  /** The button with the focus in the row. */
  focus: number;
  tab: TvTab;
  /** The line with the focus in the menu. */
  item: number;
  /** On the "Next episode" card: 0 = play now, 1 = watch the credits. */
  nextFocus: 0 | 1;
}

export const initialTvState = (): TvState => ({ open: 'none', focus: 1, tab: 'subtitles', item: 0, nextFocus: 0 });

export type TvAction =
  | { type: 'toggle' }
  | { type: 'step'; side: 'back' | 'forward' }
  | { type: 'seek'; by: number }
  | { type: 'next' }
  | { type: 'dismissNext' }
  | { type: 'skip' }
  | { type: 'show' }
  | { type: 'pick'; tab: TvTab; index: number };

export interface TvContext {
  buttons: TvButton[];
  tabs: TvTab[];
  /** How many lines each tab has. */
  items: Partial<Record<TvTab, number>>;
  /** The line that is chosen now in each tab (the menu opens there). */
  selected: Partial<Record<TvTab, number>>;
  /** A skip button (intro, recap, credits) is offered. */
  skip: boolean;
  /** The "Next episode" card is up. */
  upNext: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * What a key does: the new state, what the player should do (or null), and whether the key was used.
 * An unused Back is left to the app: it leaves the player.
 */
export function pressKey(state: TvState, key: RemoteKey, ctx: TvContext): { state: TvState; action: TvAction | null; handled: boolean } {
  const s = { ...state };
  const { buttons, tabs } = ctx;
  const done = (action: TvAction | null = null) => ({ state: s, action, handled: true });
  if (key === 'playpause') return done({ type: 'toggle' });
  if (key === 'forward' || key === 'rewind') return done({ type: 'seek', by: key === 'forward' ? FAST_STEP : -FAST_STEP });

  if (s.open === 'menu') {
    const count = Math.max(1, ctx.items[s.tab] ?? 1);
    if (key === 'up') s.item = clamp(s.item - 1, 0, count - 1);
    else if (key === 'down') s.item = clamp(s.item + 1, 0, count - 1);
    else if (key === 'left' || key === 'right') {
      const at = Math.max(0, tabs.indexOf(s.tab));
      s.tab = tabs[clamp(at + (key === 'left' ? -1 : 1), 0, tabs.length - 1)] ?? s.tab;
      s.item = ctx.selected[s.tab] ?? 0;
    } else if (key === 'ok') {
      s.open = 'none';
      return done({ type: 'pick', tab: s.tab, index: s.item });
    } else if (key === 'back') s.open = 'bar';
    return done();
  }

  if (s.open === 'bar') {
    s.focus = clamp(s.focus, 0, buttons.length - 1);
    if (key === 'left') s.focus = clamp(s.focus - 1, 0, buttons.length - 1);
    else if (key === 'right') s.focus = clamp(s.focus + 1, 0, buttons.length - 1);
    else if (key === 'down' || key === 'back') {
      s.open = 'none';
      return done();
    } else if (key === 'ok') {
      const button = buttons[s.focus];
      if (button === 'back' || button === 'forward') return done({ type: 'step', side: button });
      if (button === 'play') return done({ type: 'toggle' });
      if (button === 'next') return done({ type: 'next' });
      if (button === 'subtitles' || button === 'audio') {
        s.open = 'menu';
        s.tab = button;
        s.item = ctx.selected[button] ?? 0;
      }
    }
    return done({ type: 'show' });
  }

  // Nothing open: the card or the skip button has the focus, otherwise the keys play and jump.
  if (ctx.upNext) {
    if (key === 'left' || key === 'right') s.nextFocus = key === 'left' ? 0 : 1;
    else if (key === 'ok') return done(s.nextFocus === 0 ? { type: 'next' } : { type: 'dismissNext' });
    else if (key === 'back') return done({ type: 'dismissNext' });
    else if (key === 'up' || key === 'down') {
      s.open = 'bar';
      s.focus = Math.max(0, buttons.indexOf('play'));
      return done({ type: 'show' });
    }
    return done();
  }
  if (key === 'ok') return done(ctx.skip ? { type: 'skip' } : { type: 'toggle' });
  if (key === 'left' || key === 'right') return done({ type: 'step', side: key === 'left' ? 'back' : 'forward' });
  if (key === 'up' || key === 'down') {
    s.open = 'bar';
    s.focus = Math.max(0, buttons.indexOf('play'));
    return done({ type: 'show' });
  }
  return { state: s, action: null, handled: false };
}

/**
 * Where the marks for the recap, intro and credits go on the bar (fractions of the length), as on the
 * cast player; only when the segments belong to the file that plays.
 */
export function segmentMarks(segments: EpisodeSegments | null | undefined, fileId: number, length: number): number[] {
  if (!segments || (segments.fileId !== null && segments.fileId !== fileId) || !(length > 0)) return [];
  return [segments.recap, segments.intro, segments.credits]
    .flatMap((span) => (span ? [span.start, span.end] : []))
    .filter((t) => t > 0 && t < length)
    .map((t) => Math.round((t / length) * 10000) / 10000);
}
