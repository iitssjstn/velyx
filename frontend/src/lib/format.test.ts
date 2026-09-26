import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { episodeCode, formatBitrate, formatBytes, formatClock, formatIn, formatRuntime, imageUrl, intervalLabel, progressFraction, resolutionLabel, greeting, scheduleLabel } from './format';

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
    expect(formatBytes(3000 * 1024 ** 3)).toBe('2.9 TB');
  });
  it('writes sizes and bitrates the Dutch way in Dutch', async () => {
    await setLanguage('nl');
    try {
      expect(formatBytes(4.2 * 1024 ** 3)).toBe('4,2 GB');
      expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB');
      expect(formatBitrate(24_000_000)).toBe('24,0 Mbps');
      expect(formatBitrate(640_000)).toBe('640 kbps');
    } finally {
      await setLanguage('en');
    }
    expect(formatBitrate(24_000_000)).toBe('24.0 Mbps');
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

describe('scan schedule labels', () => {
  const now = Date.UTC(2026, 8, 26, 12);
  it('describes intervals and the next run', () => {
    expect(intervalLabel(0)).toBe('Off');
    expect(intervalLabel(60)).toBe('Every hour');
    expect(intervalLabel(360)).toBe('Every 6 hours');
    expect(intervalLabel(1440)).toBe('Every day');
    expect(intervalLabel(45)).toBe('Every 45 minutes');
    expect(formatIn(now + 25 * 60_000, now)).toBe('in 25 min');
    expect(formatIn(now + 3 * 3_600_000, now)).toBe('in 3 h');
    expect(formatIn(now - 1000, now)).toBe('now');
    expect(scheduleLabel({ intervalMinutes: 360, nextAt: now + 3 * 3_600_000, waitingForPlayback: false }, now)).toBe('Next in 3 h (every 6 hours)');
    expect(scheduleLabel({ intervalMinutes: 360, nextAt: now, waitingForPlayback: true }, now)).toBe('Waiting until nobody is watching');
    expect(scheduleLabel({ intervalMinutes: 0, nextAt: null, waitingForPlayback: false }, now)).toBe('Off');
  });
});
