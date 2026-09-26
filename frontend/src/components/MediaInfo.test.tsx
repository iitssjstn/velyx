import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaInfo } from './MediaInfo';
import type { MediaFileInfo } from '../lib/types';

const file = {
  id: 1,
  fileName: 'Heat (1995) 2160p BluRay REMUX.mkv',
  container: 'mkv',
  size: 60 * 1024 ** 3,
  durationSec: 10200,
  bitrate: 50_000_000,
  videoCodec: 'hevc',
  videoProfile: 'Main 10',
  width: 3840,
  height: 2160,
  fps: 23.976,
  audioTracks: [],
  externalSubtitles: [],
  embeddedSubtitles: [{ index: 3, codec: 'hdmv_pgs_subtitle', language: 'eng', languageName: 'English', title: null, textBased: false, isDefault: false, isForced: false }],
  probeError: null,
} as unknown as MediaFileInfo;

describe('MediaInfo', () => {
  it('shows what the file replaced, and that watch history was kept', () => {
    render(
      <MediaInfo
        file={file}
        replacements={[
          {
            at: Date.now() - 2 * 86_400_000,
            previous: { name: 'Heat (1995) 1080p WEB-DL.mkv', size: 4.2 * 1024 ** 3, width: 1920, height: 1080, videoCodec: 'h264', videoRange: 'SDR', audioCodec: 'eac3', audioChannels: 6, source: 'WEB' },
            current: { name: file.fileName, size: 60 * 1024 ** 3, width: 3840, height: 2160, videoCodec: 'hevc', videoRange: 'HDR10', audioCodec: 'truehd', audioChannels: 8, source: 'Blu-ray Remux' },
          },
        ]}
      />,
    );
    expect(screen.getByText('Replaced')).toBeTruthy();
    expect(document.body.textContent).toContain('1080p · H.264 · WEB · 4.2 GB → 2160p · HEVC · HDR10 · Blu-ray Remux · 60.0 GB');
    expect(screen.getByText('Watch history was kept.')).toBeTruthy();
    // Image subtitles are described honestly.
    expect(document.body.textContent).toContain('PGS · image-based, not shown');
  });

  it('has no replacement row for files that were never replaced', () => {
    render(<MediaInfo file={file} />);
    expect(screen.queryByText('Replaced')).toBeNull();
  });
});
