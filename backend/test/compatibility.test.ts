import { describe, expect, it } from 'vitest';
import { PlaybackRegistry, type ClientCapabilities, type MediaFileRow } from '../src/playback/engine.js';
import { DirectPlayEngine } from '../src/playback/direct-play.js';
import { RemuxEngine } from '../src/playback/remux.js';
import { analyzePlayback, browserName, fileIssues, libraryVerdict, videoSupport } from '../src/playback/compatibility.js';
import { bitDepthOf, videoRangeOf } from '../src/services/probe.js';

const CHROME: ClientCapabilities = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'flac'], tenBitCodecs: ['vp9', 'av1'] };
const SAFARI: ClientCapabilities = { containers: ['mp4', 'mov'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'mp3', 'ac3', 'eac3'], tenBitCodecs: ['hevc'] };
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

function file(over: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: 9,
    container: 'mkv',
    videoCodec: 'h264',
    videoBitDepth: 8,
    videoRange: 'SDR',
    width: 1920,
    height: 1080,
    audioCodec: 'aac',
    audioChannels: 2,
    durationSec: 6000,
    probeError: null,
    subtitleTracks: [],
    audioTracks: [{ index: 1, codec: 'aac', language: 'eng', channels: 2, channelLayout: 'stereo', title: null, isDefault: true }],
    ...over,
  } as MediaFileRow;
}

function decideAndAnalyze(f: MediaFileRow, caps: ClientCapabilities, ua?: string) {
  const r = new PlaybackRegistry();
  r.register(new DirectPlayEngine());
  r.register(new RemuxEngine('ffmpeg'));
  const d = r.decide(f, caps)!;
  return { d, a: analyzePlayback(f, caps, d, ua) };
}

describe('playback analysis', () => {
  it('direct plays compatible files with no server load', () => {
    const { d, a } = decideAndAnalyze(file(), CHROME);
    expect(d.engine).toBe('direct');
    expect(a).toMatchObject({ mode: 'direct', transcodeRequired: false, serverTranscoding: false, serverLoad: 'none', problems: [] });
    expect(a.video.action).toBe('direct');
    expect(a.audio.action).toBe('direct');
  });

  it('remuxes DTS audio and explains the conversion', () => {
    const dts = file({ audioCodec: 'dts', audioChannels: 6, audioTracks: [{ index: 1, codec: 'dts', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true }] });
    const { a } = decideAndAnalyze(dts, CHROME);
    expect(a).toMatchObject({ mode: 'remux', serverLoad: 'low', transcodeRequired: false });
    expect(a.video.action).toBe('copy');
    expect(a.audio).toMatchObject({ action: 'convert', label: 'DTS', target: 'AAC stereo' });
  });

  it('explains HEVC in Firefox as unsupported without transcoding', () => {
    const hevc = file({ videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', width: 3840, height: 2160 });
    const { a } = decideAndAnalyze(hevc, { ...CHROME, videoCodecs: ['h264', 'vp9', 'av1'] }, FIREFOX_UA);
    expect(a.mode).toBe('unsupported');
    expect(a.browser).toBe('Firefox');
    expect(a.transcodeRequired).toBe(true);
    expect(a.video).toMatchObject({ label: 'HEVC / H.265', bitDepth: 10, range: 'HDR10', action: 'unsupported' });
    expect(a.problems[0]).toMatch(/cannot decode HEVC/);
  });

  it('plays 10-bit HEVC in Safari but warns about HDR on an SDR screen', () => {
    const hevc = file({ container: 'mp4', videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', audioCodec: 'eac3', audioTracks: [{ index: 1, codec: 'eac3', language: null, channels: 6, channelLayout: '5.1', title: null, isDefault: true }] });
    const { a } = decideAndAnalyze(hevc, { ...SAFARI, hdr: false });
    expect(a.mode).toBe('direct');
    expect(a.warnings.join(' ')).toMatch(/washed out/);
  });

  it('rejects 10-bit H.264 (Hi10P) everywhere', () => {
    const hi10 = file({ videoBitDepth: 10 });
    expect(videoSupport(hi10, CHROME)).toMatchObject({ ok: false });
    const { d, a } = decideAndAnalyze(hi10, CHROME);
    expect(d.compatible).toBe(false);
    expect(a.mode).toBe('unsupported');
    expect(a.problems[0]).toMatch(/Hi10P/);
  });

  it('flags image subtitles and unknown capabilities as warnings', () => {
    const pgs = file({ subtitleTracks: [{ index: 3, codec: 'hdmv_pgs_subtitle', language: 'nld', title: null, isDefault: false, isForced: false, textBased: false }] });
    const { a } = decideAndAnalyze(pgs, {});
    expect(a.mode).toBe('direct');
    expect(a.warnings.join(' ')).toMatch(/PGS/);
    expect(a.warnings.join(' ')).toMatch(/did not report/);
  });

  it('names browsers from the user agent', () => {
    expect(browserName(FIREFOX_UA)).toBe('Firefox');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('Edge');
    expect(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Safari');
    expect(browserName(undefined)).toBeNull();
  });
});

describe('library compatibility', () => {
  it('classifies files from cached probe data', () => {
    expect(libraryVerdict(file())).toBe('direct');
    expect(libraryVerdict(file({ audioCodec: 'eac3' }))).toBe('remux');
    expect(libraryVerdict(file({ container: 'avi' }))).toBe('remux');
    expect(libraryVerdict(file({ videoCodec: 'hevc' }))).toBe('browser-dependent');
    expect(libraryVerdict(file({ videoCodec: 'mpeg4' }))).toBe('incompatible');
    expect(libraryVerdict(file({ videoBitDepth: 10 }))).toBe('incompatible');
    expect(libraryVerdict(file({ probeError: 'bad' }))).toBe('unknown');
  });

  it('lists common problems', () => {
    const f = file({ videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', audioCodec: 'truehd', subtitleTracks: [{ index: 3, codec: 'hdmv_pgs_subtitle', language: null, title: null, isDefault: false, isForced: false, textBased: false }] });
    expect(fileIssues(f)).toEqual(['HEVC video', '10-bit video', 'HDR', 'Dolby TrueHD audio', 'Image subtitles (PGS/VobSub)']);
  });
});

describe('probe details', () => {
  it('reads bit depth and dynamic range', () => {
    expect(bitDepthOf({ pix_fmt: 'yuv420p10le' })).toBe(10);
    expect(bitDepthOf({ pix_fmt: 'yuv420p' })).toBe(8);
    expect(bitDepthOf({ bits_per_raw_sample: '12' })).toBe(12);
    expect(videoRangeOf({ color_transfer: 'smpte2084' })).toBe('HDR10');
    expect(videoRangeOf({ color_transfer: 'arib-std-b67' })).toBe('HLG');
    expect(videoRangeOf({ color_transfer: 'smpte2084', side_data_list: [{ side_data_type: 'DOVI configuration record' }] })).toBe('DV');
    expect(videoRangeOf({ color_transfer: 'bt709' })).toBe('SDR');
  });
});
