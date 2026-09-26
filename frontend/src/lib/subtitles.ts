import type { CSSProperties } from 'react';
import { SUBTITLE_SIZES, type PlaybackPrefs } from './prefs';

export interface CueSpan {
  text: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0', '&lrm;': '\u200e', '&rlm;': '\u200f', '&quot;': '"', '&#39;': "'" };

/**
 * Turns WebVTT cue text into lines of styled spans. Only italic, bold and underline are kept;
 * voice/class/timestamp tags are dropped. Output is plain data rendered by React, so subtitle files
 * can never inject HTML.
 */
export function parseCueText(text: string): CueSpan[][] {
  const lines: CueSpan[][] = [];
  let line: CueSpan[] = [];
  const state = { italic: 0, bold: 0, underline: 0 };
  const push = (t: string) => {
    if (!t) return;
    const decoded = t.replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (m) => ENTITIES[m] ?? m);
    line.push({ text: decoded, italic: state.italic > 0, bold: state.bold > 0, underline: state.underline > 0 });
  };
  const re = /<\/?([a-z]+)(?:[.\s][^>]*)?>|<\d{2}:[\d:.]+>|\n/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[0];
    if (tag === '\n') {
      lines.push(line);
      line = [];
      continue;
    }
    const name = (m[1] ?? '').toLowerCase();
    const delta = tag.startsWith('</') ? -1 : 1;
    if (name === 'i') state.italic = Math.max(0, state.italic + delta);
    else if (name === 'b') state.bold = Math.max(0, state.bold + delta);
    else if (name === 'u') state.underline = Math.max(0, state.underline + delta);
  }
  push(text.slice(last));
  lines.push(line);
  return lines.filter((l) => l.some((s) => s.text.trim().length > 0));
}

const EDGES: Record<PlaybackPrefs['subtitleEdge'], string> = {
  shadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)',
  outline: '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 2px 4px rgba(0,0,0,0.6)',
  none: 'none',
};
const BACKGROUNDS: Record<PlaybackPrefs['subtitleBackground'], string> = {
  none: 'transparent',
  translucent: 'rgba(0,0,0,0.55)',
  solid: 'rgba(0,0,0,0.92)',
};
const COLORS: Record<PlaybackPrefs['subtitleColor'], string> = { white: '#ffffff', yellow: '#ffe14d' };

/** Inline style for one subtitle line, derived from the viewer's preferences. */
export function subtitleLineStyle(prefs: Pick<PlaybackPrefs, 'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitleEdge'>): CSSProperties {
  return {
    fontSize: SUBTITLE_SIZES[prefs.subtitleSize],
    color: COLORS[prefs.subtitleColor],
    backgroundColor: BACKGROUNDS[prefs.subtitleBackground],
    textShadow: EDGES[prefs.subtitleEdge],
    padding: prefs.subtitleBackground === 'none' ? '0' : '0.1em 0.45em',
    borderRadius: '0.2em',
    lineHeight: 1.3,
    fontWeight: 500,
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  };
}

/** Distance from the bottom: above the controls when they are visible, plus the viewer's offset. */
export function subtitleBottom(controlsVisible: boolean, position: number): string {
  const p = Math.max(0, Math.min(20, position));
  // --player-controls is the height of the player's control bar (larger on big screens).
  return controlsVisible ? `calc(var(--player-controls, 7.5rem) + ${p}%)` : `calc(5% + ${p}%)`;
}
