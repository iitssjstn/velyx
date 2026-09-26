import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StreamRow, formatWatched, modeLabel, streamFormat } from './ActiveStreams';
import type { ActiveStream } from '../lib/types';

const stream: ActiveStream = {
  id: '1:5', sessionId: 9, userId: 1, username: 'anna', mediaFileId: 5, movieId: 3, episodeId: null, showId: null,
  title: 'Dune', subtitle: '2021', mode: 'remux', audioConversion: 'AAC 5.1', container: 'mkv', videoCodec: 'hevc', audioCodec: 'truehd',
  width: 3840, height: 2160, bitrate: 42_500_000, device: 'Chrome on Windows', startedAt: 1_000_000, lastSeenAt: 1_000_000,
  positionSec: 1800, durationSec: 9360, watchedSec: 1750,
};

describe('active streams', () => {
  it('describes how a stream is sent', () => {
    expect(modeLabel(stream)).toBe('Remux · Audio → AAC 5.1');
    expect(modeLabel({ mode: 'direct', audioConversion: null })).toBe('Direct Play');
    expect(modeLabel({ mode: 'remux', audioConversion: null })).toBe('Remux');
    expect(streamFormat(stream)).toMatch(/^HEVC · 4K · 42\.5 Mbps · MKV → MP4 · .+ → AAC 5\.1$/);
    expect(streamFormat({ ...stream, mode: 'direct', audioConversion: null, container: 'mp4', audioCodec: 'aac' })).toMatch(/· MP4 · AAC$/);
  });

  it('formats watch time', () => {
    expect(formatWatched(42)).toBe('42 s');
    expect(formatWatched(720)).toBe('12 min');
    expect(formatWatched(3900)).toBe('1 h 05 min');
  });

  it('shows who, what, position and mode', () => {
    render(<MemoryRouter><ul><StreamRow s={stream} now={1_000_000 + 65_000} /></ul></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Dune' }).getAttribute('href')).toBe('/movies/3');
    expect(screen.getByText(/anna · Chrome on Windows/)).toBeTruthy();
    expect(screen.getByText('30:00 / 2:36:00')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText('Remux · Audio → AAC 5.1')).toBeTruthy();
  });
});
