import { describe, expect, it } from 'vitest';
import { GLOW, palette } from './palette';

describe('palette', () => {
  it('is grey with a touch of purple, with grey-purple buttons and white text (phone and TV alike)', () => {
    expect(palette).toMatchObject({ bg: '#1d1c25', surface: '#26242f', button: '#6b6582', buttonInk: '#ffffff' });
    // Focus rings and progress stay in the light accent, so they show on the grey.
    expect(palette.accent).toBe('#b69cff');
  });
  it('glows in purple, more under the chosen item than under a button', () => {
    expect(GLOW.focus).toMatch(/rgba\(150, 120, 235, 0\.8\)$/);
    expect(GLOW.button).toMatch(/rgba\(130, 110, 190, 0\.55\)$/);
  });
});
