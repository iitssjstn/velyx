import { describe, expect, it } from 'vitest';
import { episodeCode, formatBytes, formatClock, formatRuntime, imageUrl, progressFraction, resolutionLabel, greeting } from './format';

describe('format helpers', () => {
  it('formats clocks', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
  it('formats runtimes', () => {
    expect(formatRuntime(169)).toBe('2h 49m');
    expect(formatRuntime(47)).toBe('47m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(null)).toBeNull();
  });
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB');
  });
  it('builds proxied image URLs only', () => {
    expect(imageUrl('/abc.jpg', 'w342')).toBe('/api/images/w342/abc.jpg');
    expect(imageUrl(null)).toBeNull();
  });
  it('labels resolutions and episodes', () => {
    expect(resolutionLabel(3840, 1600)).toBe('4K');
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(episodeCode(1, 2)).toBe('S01E02');
  });
  it('computes progress', () => {
    expect(progressFraction({ positionSec: 30, durationSec: 60 })).toBe(0.5);
    expect(progressFraction({ positionSec: 90, durationSec: 60 })).toBe(1);
    expect(progressFraction(null)).toBe(0);
  });
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening');
  });
});
