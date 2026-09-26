import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaybackBadge, PlaybackUnavailable, modeLabel } from './PlaybackDetails';
import type { PlaybackAnalysis } from '../lib/types';

const base: PlaybackAnalysis = {
  mode: 'direct',
  browser: 'Chrome',
  video: { codec: 'h264', label: 'H.264', width: 1920, height: 1080, bitDepth: 8, range: 'SDR', action: 'direct' },
  audio: { codec: 'aac', label: 'AAC', channels: 2, action: 'direct', target: null },
  container: { name: 'mp4', action: 'direct' },
  problems: [],
  warnings: [],
  transcodeRequired: false,
  serverTranscoding: false,
  serverLoad: 'none',
};

const remux: PlaybackAnalysis = {
  ...base,
  mode: 'remux',
  video: { ...base.video, action: 'copy' },
  audio: { codec: 'dts', label: 'DTS', channels: 6, action: 'convert', target: 'AAC stereo' },
  container: { name: 'mkv', action: 'remux' },
  serverLoad: 'low',
};

const hevcFirefox: PlaybackAnalysis = {
  ...base,
  mode: 'unsupported',
  browser: 'Firefox',
  video: { codec: 'hevc', label: 'HEVC / H.265', width: 3840, height: 2160, bitDepth: 10, range: 'HDR10', action: 'unsupported' },
  problems: ['This browser cannot decode HEVC / H.265 video.'],
  transcodeRequired: true,
};

describe('modeLabel', () => {
  it('describes the playback mode', () => {
    expect(modeLabel(base)).toBe('Direct Play');
    expect(modeLabel(remux)).toBe('Remux • Audio converted to AAC');
    expect(modeLabel({ ...remux, audio: { ...remux.audio, action: 'copy', target: null } })).toBe('Remux');
  });
});

describe('PlaybackBadge', () => {
  it('opens a details panel explaining what the server does', async () => {
    render(<PlaybackBadge analysis={remux} />);
    await userEvent.click(screen.getByRole('button', { name: /Remux • Audio converted to AAC/ }));
    const panel = screen.getByRole('dialog', { name: 'Playback details' });
    expect(panel.textContent).toContain('copied without re-encoding');
    expect(panel.textContent).toContain('DTS 5.1 → AAC stereo');
    expect(panel.textContent).toContain('Server transcodingNo');
  });
});

describe('PlaybackUnavailable', () => {
  it('explains codec, browser and why transcoding is not offered', async () => {
    const onTry = vi.fn();
    render(<PlaybackUnavailable analysis={hevcFirefox} onBack={() => undefined} onTryAnyway={onTry} />);
    expect(screen.getByRole('heading', { name: 'Playback unavailable' })).toBeTruthy();
    expect(screen.getByText('HEVC / H.265 • 4K • 10-bit • HDR10')).toBeTruthy();
    expect(screen.getByText('Firefox')).toBeTruthy();
    expect(screen.getByText('This browser cannot decode HEVC / H.265 video.')).toBeTruthy();
    expect(document.body.textContent).toContain('Velyx does not transcode video');
    await userEvent.click(screen.getByRole('button', { name: 'Try anyway' }));
    expect(onTry).toHaveBeenCalledOnce();
  });
});
