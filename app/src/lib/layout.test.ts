import { describe, expect, it } from 'vitest';
import { gridLayout, isWide } from './layout';

describe('layout', () => {
  it('shows three posters across on a phone', () => {
    const g = gridLayout(390);
    expect(g.columns).toBe(3);
    expect(g.itemWidth * 3 + 2 * 12 + 32).toBeCloseTo(390);
  });
  it('shows more on a tablet', () => {
    expect(gridLayout(800).columns).toBe(6);
    expect(gridLayout(1280).columns).toBe(9);
  });
  it('calls tablets and landscape phones wide', () => {
    expect(isWide(390)).toBe(false);
    expect(isWide(800)).toBe(true);
  });
});
