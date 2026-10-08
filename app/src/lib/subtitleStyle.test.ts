import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE, TV_SUBTITLE_STYLE, castSubtitlePreview, editSubtitleStyle, clampPosition, readSubtitleStyle, stepDelay, subtitleBottom, subtitleFontSize, subtitleTextStyle } from './subtitleStyle';

describe('reading a stored subtitle style', () => {
  it('falls back to the defaults for nothing or garbage', () => {
    expect(readSubtitleStyle(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(readSubtitleStyle('x')).toEqual(DEFAULT_SUBTITLE_STYLE);
    expect(readSubtitleStyle({ size: 'huge', color: 'red', position: 'high' })).toEqual(DEFAULT_SUBTITLE_STYLE);
  });
  it('keeps valid choices', () => {
    expect(readSubtitleStyle({ size: 'large', color: 'yellow', background: 'solid', edge: 'outline', position: 10 })).toEqual({ size: 'large', color: 'yellow', background: 'solid', edge: 'outline', position: 10, castDefaults: false });
  });
  it('preserves an explicit TV preference and migrates old defaults as custom', () => {
    expect(readSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, castDefaults: false }).castDefaults).toBe(false);
    expect(readSubtitleStyle({ size: 'medium', color: 'white', background: 'none', edge: 'shadow', position: 0 }).castDefaults).toBe(false);
    expect(readSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, color: 'yellow' }).castDefaults).toBe(true);
  });
  it('keeps the position within 0–20 in steps of 5', () => {
    expect(clampPosition(-5)).toBe(0);
    expect(clampPosition(7)).toBe(5);
    expect(clampPosition(99)).toBe(20);
    expect(clampPosition(NaN)).toBe(0);
  });
});

describe('how subtitles look', () => {
  it('previews the TV default without changing local choices', () => {
    const local = { ...DEFAULT_SUBTITLE_STYLE, color: 'yellow' as const, size: 'xlarge' as const };
    expect(castSubtitlePreview(local)).toEqual(TV_SUBTITLE_STYLE);
    expect(subtitleTextStyle(castSubtitlePreview(local), 220)).toMatchObject({ color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', textShadowRadius: 3 });
    expect(subtitleTextStyle(local, 220).color).toBe('#ffe14d');
    expect(castSubtitlePreview({ ...local, castDefaults: false })).toMatchObject({ color: 'yellow', size: 'xlarge' });
  });
  it('turns custom mode on for appearance edits, not local position edits', () => {
    for (const patch of [{ size: 'small' as const }, { color: 'yellow' as const }, { background: 'solid' as const }, { edge: 'none' as const }]) {
      expect(editSubtitleStyle(DEFAULT_SUBTITLE_STYLE, patch).castDefaults).toBe(false);
    }
    expect(editSubtitleStyle(DEFAULT_SUBTITLE_STYLE, { position: 10 }).castDefaults).toBe(true);
    const custom = editSubtitleStyle(DEFAULT_SUBTITLE_STYLE, { color: 'yellow' });
    expect(editSubtitleStyle(custom, { castDefaults: true })).toMatchObject({ castDefaults: true, color: 'yellow' });
  });
  it('grows with the size choice and the screen', () => {
    expect(subtitleFontSize('small', 400)).toBeLessThan(subtitleFontSize('medium', 400));
    expect(subtitleFontSize('large', 400)).toBeLessThan(subtitleFontSize('xlarge', 400));
    expect(subtitleFontSize('medium', 1000)).toBeGreaterThan(subtitleFontSize('medium', 400));
    expect(subtitleFontSize('small', 100)).toBe(13);
  });
  it('applies colour, background and edge', () => {
    const s = subtitleTextStyle({ ...DEFAULT_SUBTITLE_STYLE, color: 'yellow', background: 'solid', edge: 'none' }, 400);
    expect(s.color).toBe('#ffe14d');
    expect(s.backgroundColor).toBe('rgba(0,0,0,0.92)');
    expect(s.paddingHorizontal).toBeGreaterThan(0);
    expect(s.textShadowRadius).toBe(0);
    const plain = subtitleTextStyle(DEFAULT_SUBTITLE_STYLE, 400);
    expect(plain.backgroundColor).toBe('transparent');
    expect(plain.paddingHorizontal).toBe(0);
    expect(plain.textShadowRadius).toBeGreaterThan(0);
  });
  it('stays above the controls and moves up with the position', () => {
    expect(subtitleBottom(DEFAULT_SUBTITLE_STYLE, 400, true)).toBe(96);
    expect(subtitleBottom(DEFAULT_SUBTITLE_STYLE, 400, false)).toBe(20);
    expect(subtitleBottom({ ...DEFAULT_SUBTITLE_STYLE, position: 10 }, 400, false)).toBe(60);
  });
});

describe('subtitle timing', () => {
  it('steps by half a second without rounding errors', () => {
    expect(stepDelay(0, 1)).toBe(0.5);
    expect(stepDelay(0.5, -1)).toBe(0);
    expect(stepDelay(-1.5, -1)).toBe(-2);
  });
  it('stays within 30 seconds', () => {
    expect(stepDelay(30, 1)).toBe(30);
    expect(stepDelay(-30, -1)).toBe(-30);
  });
});
