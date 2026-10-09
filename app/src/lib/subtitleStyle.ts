/**
 * How subtitles look in the app: the same choices as on the website (size, colour, background,
 * edge, position), kept per device. Timing (sync) is per playback and not stored.
 */

export type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = 'white' | 'yellow';
export type SubtitleBackground = 'none' | 'translucent' | 'solid';
export type SubtitleEdge = 'shadow' | 'outline' | 'none';

export interface SubtitleStyle {
  size: SubtitleSize;
  color: SubtitleColor;
  background: SubtitleBackground;
  edge: SubtitleEdge;
  /** Extra distance from the bottom, in percent of the picture height (0–20, steps of 5). */
  position: number;
  /** Use the readable TV preset without changing the local subtitle choices. */
  castDefaults?: boolean;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { size: 'medium', color: 'white', background: 'none', edge: 'shadow', position: 0, castDefaults: true };
export const TV_SUBTITLE_STYLE: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, background: 'translucent', edge: 'outline' };

const SIZES: SubtitleSize[] = ['small', 'medium', 'large', 'xlarge'];
const COLORS: SubtitleColor[] = ['white', 'yellow'];
const BACKGROUNDS: SubtitleBackground[] = ['none', 'translucent', 'solid'];
const EDGES: SubtitleEdge[] = ['shadow', 'outline', 'none'];

const pick = <T extends string>(list: T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);

/** A stored style read back safely: unknown or missing values fall back to the defaults. */
export function readSubtitleStyle(raw: unknown): SubtitleStyle {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SUBTITLE_STYLE;
  const hasLegacyStyle = SIZES.includes(o.size as SubtitleSize) || COLORS.includes(o.color as SubtitleColor) || BACKGROUNDS.includes(o.background as SubtitleBackground) || EDGES.includes(o.edge as SubtitleEdge) || (typeof o.position === 'number' && Number.isFinite(o.position));
  return {
    size: pick(SIZES, o.size, d.size),
    color: pick(COLORS, o.color, d.color),
    background: pick(BACKGROUNDS, o.background, d.background),
    edge: pick(EDGES, o.edge, d.edge),
    position: clampPosition(typeof o.position === 'number' ? o.position : d.position),
    castDefaults: typeof o.castDefaults === 'boolean' ? o.castDefaults : !hasLegacyStyle,
  };
}

export function editSubtitleStyle(style: SubtitleStyle, patch: Partial<SubtitleStyle>): SubtitleStyle {
  const custom = ['size', 'color', 'background', 'edge'].some((key) => key in patch);
  return readSubtitleStyle({ ...style, ...patch, ...(custom ? { castDefaults: false } : {}) });
}

export function castSubtitlePreview(style: SubtitleStyle): SubtitleStyle {
  const valid = readSubtitleStyle(style);
  return valid.castDefaults ? TV_SUBTITLE_STYLE : valid;
}

export function clampPosition(p: number): number {
  return Number.isFinite(p) ? Math.max(0, Math.min(20, Math.round(p / 5) * 5)) : 0;
}

/** Font size in points for a picture of `height` points: grows with the screen, like the website. */
export function subtitleFontSize(size: SubtitleSize, height: number): number {
  const factor = { small: 0.042, medium: 0.052, large: 0.064, xlarge: 0.078 }[size];
  const min = { small: 13, medium: 15, large: 18, xlarge: 21 }[size];
  return Math.round(Math.max(min, height * factor));
}

/** The text style (React Native style properties) for subtitles. */
export function subtitleTextStyle(style: SubtitleStyle, height: number) {
  const fontSize = subtitleFontSize(style.size, height);
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.3),
    fontWeight: '500' as const,
    textAlign: 'center' as const,
    color: style.color === 'yellow' ? '#ffe14d' : '#ffffff',
    backgroundColor: { none: 'transparent', translucent: 'rgba(0,0,0,0.55)', solid: 'rgba(0,0,0,0.92)' }[style.background],
    paddingHorizontal: style.background === 'none' ? 0 : Math.round(fontSize * 0.45),
    paddingVertical: style.background === 'none' ? 0 : Math.round(fontSize * 0.1),
    borderRadius: Math.round(fontSize * 0.2),
    textShadowColor: style.edge === 'none' ? 'transparent' : 'rgba(0,0,0,0.95)',
    textShadowOffset: style.edge === 'outline' ? { width: 0, height: 0 } : { width: 0, height: 2 },
    // A tight dark halo reads as an outline; a softer one as a drop shadow.
    textShadowRadius: style.edge === 'none' ? 0 : style.edge === 'outline' ? 3 : 4,
  };
}

/** Distance from the bottom in points: above the controls when they are shown, plus the viewer's offset. */
export function subtitleBottom(style: SubtitleStyle, height: number, controls: boolean): number {
  const base = controls ? 96 : Math.round(height * 0.05);
  return base + Math.round((height * clampPosition(style.position)) / 100);
}

/** One step of the subtitle timing: 0.5 s, kept to one decimal, within ±30 s. */
export function stepDelay(delay: number, direction: 1 | -1): number {
  return Math.max(-30, Math.min(30, Math.round((delay + direction * 0.5) * 10) / 10));
}
