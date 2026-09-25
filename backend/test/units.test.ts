import { describe, expect, it } from 'vitest';
import { parseRange, mimeFor, DirectPlayEngine } from '../src/playback/direct-play.js';
import { PlaybackRegistry } from '../src/playback/engine.js';
import { decodeSubtitle, srtToVtt } from '../src/services/subtitles.js';
import { mapProbeOutput } from '../src/services/probe.js';

describe('parseRange', () => {
  it('parses byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=0-0,5-9', 100)).toEqual({ start: 0, end: 0 });
  });
  it('flags unsatisfiable ranges', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=9-2', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
  });
});

describe('mime types', () => {
  it('maps common containers', () => {
    expect(mimeFor('/a/b.mp4')).toBe('video/mp4');
    expect(mimeFor('/a/b.MKV')).toBe('video/x-matroska');
    expect(mimeFor('/a/b.webm')).toBe('video/webm');
    expect(mimeFor('/a/b.xyz')).toBe('application/octet-stream');
  });
});

describe('PlaybackRegistry', () => {
  it('delegates to the first engine that returns a decision', () => {
    const reg = new PlaybackRegistry();
    reg.register({ id: 'never', decide: () => null, serve: async (_q, r) => r });
    reg.register(new DirectPlayEngine());
    const file = { id: 7, container: 'mkv', videoCodec: 'hevc', audioCodec: 'dts' } as never;
    const d = reg.decide(file, {});
    expect(d).toMatchObject({ engine: 'direct', compatible: 'unknown', streamUrl: '/api/media/7/stream' });
    expect(d!.reasons.join(' ')).toContain('DTS');
  });
});

describe('subtitles', () => {
  it('converts SRT to WebVTT', () => {
    const vtt = srtToVtt('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000 X1:0\r\n<font color="red">Hi</font>\r\nthere\r\n\r\n2\r\n00:01:00,5 --> 00:01:01,250\r\n{\\an8}Top\r\n');
    expect(vtt).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\nthere\n\n00:01:00.5 --> 00:01:01.250\nTop\n');
  });
  it('decodes UTF-16 and Windows-1252 subtitle files', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')]);
    expect(decodeSubtitle(utf16)).toBe('héllo');
    expect(decodeSubtitle(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeSubtitle(Buffer.from('\uFEFFplain', 'utf8'))).toBe('plain');
  });
});

describe('mapProbeOutput', () => {
  it('extracts video, audio and subtitle information', () => {
    const info = mapProbeOutput(
      {
        format: { duration: '10140.5', bit_rate: '8000000' },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080, avg_frame_rate: '24000/1001' },
          { index: 1, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
          { index: 2, codec_type: 'audio', codec_name: 'eac3', channels: 6, channel_layout: '5.1(side)', tags: { language: 'eng' } },
          { index: 3, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'nld', title: 'Commentary' }, disposition: { default: 1 } },
          { index: 4, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'dut' }, disposition: { forced: 1 } },
          { index: 5, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'und' } },
        ],
      },
      'Movie.mkv',
    );
    expect(info).toMatchObject({ container: 'mkv', durationSec: 10140.5, bitrate: 8000000, videoCodec: 'h264', width: 1920, height: 1080, audioCodec: 'aac', audioChannels: 2 });
    expect(info.fps).toBeCloseTo(23.976, 2);
    expect(info.audioTracks).toHaveLength(2);
    expect(info.audioTracks[1]).toMatchObject({ title: 'Commentary', isDefault: true });
    expect(info.subtitleTracks[0]).toMatchObject({ codec: 'subrip', language: 'dut', isForced: true, textBased: true });
    expect(info.subtitleTracks[1]).toMatchObject({ language: null, textBased: false });
  });
});
