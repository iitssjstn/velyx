/**
 * What Vidalune's own TV player shows over the film (receiver.js draws it): when the bar with the
 * title and the time is up, the times in the file, and the subtitles in the sender's style.
 */

/** How long the bar stays up after the title starts, plays again or jumps. */
export const SHOW_FOR_MS = 5000;

/** 47:45, or 1:04:05 from an hour. */
export function formatTime(sec) {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Where the TV is in the file and how long the file is: a repackaged stream can start `offset`
 * seconds into it, and the sender knows the full length.
 */
export function fileTimes(target, time, duration) {
  const offset = target && target.offset > 0 ? target.offset : 0;
  const stream = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const length = target && target.durationSec > 0 ? target.durationSec : stream > 0 ? offset + stream : 0;
  const position = offset + (Number.isFinite(time) ? Math.max(0, time) : 0);
  return { position: length > 0 ? Math.min(length, position) : position, length };
}

/** The bar is up while paused or waiting, and for a while after the last change. */
export function barVisible(state, shownAt, now) {
  const s = String(state ?? '').toUpperCase();
  if (s === 'PAUSED' || s === 'BUFFERING') return true;
  return now - shownAt < SHOW_FOR_MS;
}

/** '#RRGGBBAA' (how Cast writes colours) as CSS, or null when it is not one. */
export function cssColor(value) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(value ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const a = m[2] === undefined ? 1 : parseInt(m[2], 16) / 255;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * The subtitles in the style the sender asked for (size, colour, background, edge), as CSS for the
 * player's own video. Anything missing falls back to white letters with a shadow and no background
 * (the Android sender leaves out a fully see-through background: it sends 0, "no colour given").
 */
export function cueCss(style) {
  const s = style && typeof style === 'object' ? style : {};
  const scale = Number(s.fontScale) > 0 ? Math.min(3, Number(s.fontScale)) : 1;
  const color = cssColor(s.foregroundColor) ?? 'rgba(255, 255, 255, 1)';
  const background = cssColor(s.backgroundColor) ?? 'rgba(0, 0, 0, 0)';
  const edge = cssColor(s.edgeColor) ?? 'rgba(0, 0, 0, 1)';
  const shadow =
    s.edgeType === 'NONE'
      ? 'none'
      : s.edgeType === 'OUTLINE'
        ? `-2px -2px 0 ${edge}, 2px -2px 0 ${edge}, -2px 2px 0 ${edge}, 2px 2px 0 ${edge}, 0 0 4px ${edge}`
        : `0 2px 6px ${edge}, 0 0 2px ${edge}`;
  // !important: Google's framework may style the cues itself as well; this is what the viewer chose.
  const rules = { 'font-family': "Roboto, 'Google Sans', system-ui, sans-serif", 'font-size': `${Math.round(4.6 * scale * 100) / 100}vh`, 'line-height': '1.25', color, 'background-color': background, 'text-shadow': shadow };
  return `video::cue { ${Object.entries(rules).map(([k, v]) => `${k}: ${v} !important;`).join(' ')} }`;
}
