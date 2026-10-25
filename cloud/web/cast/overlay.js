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

/** How long a subtitle may take before the TV says it is loading (a file the server has ready is in at once). */
export const SUBTITLE_LOADING_AFTER_MS = 600;
/** How long "could not be loaded" stays on the screen. */
export const SUBTITLE_ERROR_FOR_MS = 6000;

/**
 * Whether the chosen subtitle is still on its way: for a subtitle inside the file the server reads
 * the whole file first (minutes on a NAS), and until then the TV shows nothing. The TV asks for the
 * file itself, so it can say it is loading, or that it could not be loaded.
 */
export class SubtitleLoad {
  /** @param get resolves true when the file came (false or a rejection: it did not). */
  constructor(get, clock = Date.now) {
    this.get = get;
    this.clock = clock;
    this.url = null;
    this.state = null;
    this.since = 0;
    this.done = new Set();
  }

  /** The subtitle the TV shows now (null: none); the same one again changes nothing. */
  watch(url) {
    if (url === this.url) return;
    this.url = url;
    this.since = this.clock();
    if (!url || this.done.has(url)) {
      this.state = null;
      return;
    }
    this.state = 'loading';
    const settle = (ok) => {
      if (ok) this.done.add(url);
      if (this.url !== url) return;
      this.state = ok ? null : 'error';
      this.since = this.clock();
    };
    Promise.resolve()
      .then(() => this.get(url))
      .then((ok) => settle(Boolean(ok)), () => settle(false));
  }

  /** What to show now: 'loading' once it takes a moment, 'error' for a while, else null. */
  shown() {
    const age = this.clock() - this.since;
    if (this.state === 'loading') return age >= SUBTITLE_LOADING_AFTER_MS ? 'loading' : null;
    if (this.state === 'error') return age < SUBTITLE_ERROR_FOR_MS ? 'error' : null;
    return null;
  }
}

/** "CC · English" for the subtitle that is on, or nothing when subtitles are off. */
export function ccLabel(track) {
  if (!track) return '';
  const name = String(track.name || track.language || '').trim();
  return name ? `CC · ${name}` : 'CC';
}
