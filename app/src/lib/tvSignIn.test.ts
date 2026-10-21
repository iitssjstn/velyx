import { describe, expect, it } from 'vitest';
import { qrMatrix, tvSignInUrl } from './tvSignIn';

describe('signing in on a TV', () => {
  it('opens the page on vidalune.com with the code filled in', () => {
    expect(tvSignInUrl({ url: 'https://vidalune.com/tv', code: 'K7F3-Q9MA' })).toBe('https://vidalune.com/tv#K7F3-Q9MA');
  });

  it('draws a square QR code with its three corner marks', () => {
    const m = qrMatrix('https://vidalune.com/tv#K7F3-Q9MA');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // The finder patterns: a dark 7×7 ring top left, top right and bottom left.
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 6]![c + 6]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
      expect(m[r + 3]![c + 3]).toBe(true);
    }
  });

  it('gives another code another picture', () => {
    expect(qrMatrix('https://vidalune.com/tv#K7F3-Q9MA')).not.toEqual(qrMatrix('https://vidalune.com/tv#K7F3-Q9MB'));
  });
});
