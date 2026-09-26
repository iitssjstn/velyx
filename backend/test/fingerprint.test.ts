import { describe, expect, it } from 'vitest';
import { FRAME_SEC, fingerprint, longestCommonSegment } from '../src/services/segments/fingerprint.js';
import { episode, melody, silence } from './segments-helpers.js';

const sec = (frames: number) => frames * FRAME_SEC;

describe('audio fingerprints', () => {
  it('finds the same theme at different positions in two episodes', () => {
    const theme = melody(40, 7);
    const a = fingerprint(episode([melody(65, 1), theme, melody(120, 2)], 11));
    const b = fingerprint(episode([melody(20, 3), theme, melody(160, 4)], 12));
    const seg = longestCommonSegment(a, b, { minFrames: Math.round(10 / FRAME_SEC) })!;
    expect(seg).not.toBeNull();
    expect(sec(seg.aStart)).toBeCloseTo(65, 0);
    expect(sec(seg.aEnd)).toBeCloseTo(105, 0);
    expect(sec(seg.bStart)).toBeCloseTo(20, 0);
    expect(seg.ratio).toBeGreaterThan(0.6);
  });

  it('does not match different music or silence', () => {
    const a = fingerprint(episode([silence(30), melody(90, 21)], 1));
    const b = fingerprint(episode([silence(30), melody(90, 22)], 2));
    expect(longestCommonSegment(a, b, { minFrames: Math.round(10 / FRAME_SEC) })).toBeNull();
  });

  it('is fast enough for ten minutes against ten minutes', () => {
    const a = fingerprint(episode([melody(600, 31)], 1));
    const b = fingerprint(episode([melody(600, 32)], 2));
    const t = performance.now();
    longestCommonSegment(a, b, { minFrames: Math.round(10 / FRAME_SEC) });
    expect(performance.now() - t).toBeLessThan(4000);
  });
});
