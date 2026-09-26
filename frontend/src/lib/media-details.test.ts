import { describe, expect, it } from 'vitest';
import { audioLines, qualityLabel, rangeLabel, subtitleLines, technicalSummary } from './media-details';
import type { MediaFileInfo } from './types';

const file = {
  id: 1, fileName: 'Dune (2021) 2160p.mkv', size: 60 * 1024 ** 3, container: 'mkv', durationSec: 9360, bitrate: 24_000_000,
  videoCodec: 'hevc', videoProfile: 'Main 10', videoBitDepth: 10, videoRange: 'HDR10', width: 3840, height: 2160, fps: 23.976,
  audioCodec: 'eac3', audioChannels: 6,
  audioTracks: [
    { index: 1, codec: 'eac3', language: 'eng', languageName: 'English', channels: 6, channelLayout: '5.1', title: null, isDefault: true },
    { index: 2, codec: 'aac', language: 'nld', languageName: 'Dutch', channels: 2, channelLayout: 'stereo', title: null, isDefault: false },
    { index: 3, codec: 'ac3', language: 'eng', languageName: 'English', channels: 2, channelLayout: 'stereo', title: 'Director commentary', isDefault: false },
  ],
  embeddedSubtitles: [
    { index: 4, codec: 'subrip', language: 'eng', languageName: 'English', title: 'English', isDefault: false, isForced: false, textBased: true },
    { index: 5, codec: 'hdmv_pgs_subtitle', language: null, languageName: null, title: null, isDefault: false, isForced: true, textBased: false },
  ],
  externalSubtitles: [{ id: 9, language: 'nl', label: 'Dutch', format: 'srt', forced: false }],
  probeError: null,
} as MediaFileInfo;

describe('media details', () => {
  it('names the quality the way the header shows it', () => {
    expect(qualityLabel(file)).toBe('4K HDR');
    expect(qualityLabel({ width: 1920, height: 1080, videoRange: 'SDR' })).toBe('1080p');
    expect(qualityLabel({ width: 3840, height: 2160, videoRange: 'DV' })).toBe('4K Dolby Vision');
    expect(qualityLabel({ width: null, height: null, videoRange: null })).toBeNull();
    expect(qualityLabel(undefined)).toBeNull();
    expect(rangeLabel('HDR10', true)).toBe('HDR10');
    expect(rangeLabel('HLG')).toBe('HLG');
    expect(rangeLabel('SDR')).toBeNull();
  });

  it('lists audio as language and channels, with the format underneath', () => {
    expect(audioLines(file)).toEqual([
      { label: 'English 5.1', note: 'Dolby Digital+ · Default' },
      { label: 'Dutch Stereo', note: 'AAC' },
      { label: 'English Stereo', note: 'Dolby Digital · Director commentary' },
    ]);
    // One track: no "Default" to point out; unknown language said plainly.
    expect(audioLines({ ...file, audioTracks: [{ ...file.audioTracks[0], language: null, languageName: null }] })).toEqual([{ label: 'Unknown language 5.1', note: 'Dolby Digital+' }]);
  });

  it('lists subtitles, separate files first, and says which cannot be shown', () => {
    expect(subtitleLines(file)).toEqual([
      { label: 'Dutch', note: 'SRT · Separate file' },
      { label: 'English', note: 'SRT' },
      { label: 'Unknown language', note: 'PGS · Forced · image-based, not shown' },
    ]);
    expect(subtitleLines({ ...file, embeddedSubtitles: [], externalSubtitles: [] })).toEqual([]);
  });

  it('summarises the video format', () => {
    expect(technicalSummary(file)).toEqual(['HEVC', '10-bit', 'HDR10', '24.0 Mbps']);
    expect(technicalSummary({ ...file, videoCodec: 'h264', videoBitDepth: 8, videoRange: 'SDR', bitrate: null })).toEqual(['H.264', '8-bit', 'SDR']);
    // Never analysed: nothing is made up.
    expect(technicalSummary({ ...file, videoCodec: null, videoBitDepth: null, videoRange: null, bitrate: null })).toEqual([]);
  });
});
