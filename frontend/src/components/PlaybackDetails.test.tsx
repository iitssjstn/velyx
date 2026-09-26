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
  device: 'Chrome on Windows',
  confidence: 'reported',
  components: { video: { status: 'ok', note: 'Plays as-is' }, audio: { status: 'ok', note: 'Plays as-is' }, container: { status: 'ok', note: 'Supported' } },
  summary: ['No server-side conversion required.'],
};

const remux: PlaybackAnalysis = {
  ...base,
  mode: 'remux',
  video: { ...base.video, action: 'copy' },
  audio: { codec: 'dts', label: 'DTS', channels: 6, action: 'convert', target: 'AAC stereo' },
  container: { name: 'mkv', action: 'remux' },
  serverLoad: 'low',
  components: { video: { status: 'ok', note: 'Copied without re-encoding' }, audio: { status: 'warn', note: 'Converted to AAC stereo' }, container: { status: 'ok', note: 'Supported; streamed as MP4 while remuxing' } },
  summary: ['The video does not need transcoding.', 'Velyx remuxes the file and converts the audio to AAC stereo, which uses little CPU.'],
};

const hevcFirefox: PlaybackAnalysis = {
  ...base,
  mode: 'unsupported',
  browser: 'Firefox',
  video: { codec: 'hevc', label: 'HEVC / H.265', width: 3840, height: 2160, bitDepth: 10, range: 'HDR10', action: 'unsupported' },
  problems: ['This browser cannot decode HEVC / H.265 video.'],
  transcodeRequired: true,
  device: 'Firefox on Linux',
  components: { video: { status: 'fail', note: 'This browser cannot decode HEVC / H.265 video.' }, audio: { status: 'ok', note: 'Supported' }, container: { status: 'ok', note: 'Supported' } },
  summary: ['Your current browser/device cannot play this video format.', 'Server transcoding: No. Velyx does not convert video.'],
};

describe('modeLabel', () => {
  it('describes the playback mode', () => {
    expect(modeLabel(base)).toBe('Direct Play');
    expect(modeLabel(remux)).toBe('Remux · Audio → AAC');
    expect(modeLabel({ ...remux, audio: { ...remux.audio, action: 'copy', target: null } })).toBe('Remux');
  });
});

describe('PlaybackBadge', () => {
  it('opens a details panel with a status per stream', async () => {
    render(<PlaybackBadge analysis={remux} />);
    await userEvent.click(screen.getByRole('button', { name: /Remux · Audio → AAC/ }));
    const panel = screen.getByRole('dialog', { name: 'Playback details' });
    expect(panel.textContent).toContain('Copied without re-encoding');
    expect(panel.textContent).toContain('DTS 5.1');
    expect(panel.textContent).toContain('Converted to AAC stereo');
    expect(panel.textContent).toContain('The video does not need transcoding.');
    expect(panel.textContent).toContain('Server transcodingNo');
    expect(panel.textContent).toContain('Chrome on Windows');
    // ✓ video, ⚠ audio, ✓ container
    expect(screen.getAllByRole('img', { name: 'Supported' })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Converted' })).toHaveLength(1);
  });

  it('says plainly that direct play needs no conversion', async () => {
    render(<PlaybackBadge analysis={base} />);
    await userEvent.click(screen.getByRole('button', { name: /Direct Play/ }));
    expect(screen.getByText('No server-side conversion required.')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Supported' })).toHaveLength(3);
  });
});

describe('PlaybackUnavailable', () => {
  it('explains codec, device and why transcoding is not offered', async () => {
    const onTry = vi.fn();
    render(<PlaybackUnavailable analysis={hevcFirefox} onBack={() => undefined} onTryAnyway={onTry} />);
    expect(screen.getByRole('heading', { name: 'Playback unavailable' })).toBeTruthy();
    expect(screen.getByText('HEVC / H.265 • 4K • 10-bit • HDR10')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Not supported' })).toBeTruthy();
    // The reason appears once, next to the video.
    expect(screen.getAllByText('This browser cannot decode HEVC / H.265 video.')).toHaveLength(1);
    expect(screen.getByText('Your current browser/device cannot play this video format.')).toBeTruthy();
    expect(screen.getByText('Server transcoding: No. Velyx does not convert video.')).toBeTruthy();
    expect(document.body.textContent).toContain('Current device: Firefox on Linux');
    await userEvent.click(screen.getByRole('button', { name: 'Try anyway' }));
    expect(onTry).toHaveBeenCalledOnce();
  });

  it('marks uncertain verdicts with a question mark instead of a cross', () => {
    render(
      <PlaybackUnavailable
        analysis={{ ...hevcFirefox, confidence: 'assumed', components: { ...hevcFirefox.components, video: { status: 'unknown', note: 'Velyx cannot confirm that this device decodes it.' } }, summary: ['This device may not be able to play this video format.'] }}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole('img', { name: 'Not certain' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Not supported' })).toBeNull();
  });
});
