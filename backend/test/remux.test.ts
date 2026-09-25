import { describe, expect, it } from 'vitest';
import { PlaybackRegistry, type MediaFileRow } from '../src/playback/engine.js';
import { DirectPlayEngine } from '../src/playback/direct-play.js';
import { RemuxEngine, pickKeyframe, planRemux, remuxArgs } from '../src/playback/remux.js';
import { shiftVtt } from '../src/services/subtitles.js';

const CHROME = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'flac'] };

function file(over: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: 5,
    container: 'mkv',
    videoCodec: 'h264',
    audioCodec: 'eac3',
    durationSec: 5400,
    audioTracks: [
      { index: 1, codec: 'eac3', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true },
      { index: 2, codec: 'aac', language: 'nld', channels: 2, channelLayout: 'stereo', title: 'Dutch', isDefault: false },
    ],
    ...over,
  } as MediaFileRow;
}

function registry() {
  const r = new PlaybackRegistry();
  r.register(new DirectPlayEngine());
  r.register(new RemuxEngine('ffmpeg', 'ffprobe'));
  return r;
}

describe('playback decisions', () => {
  it('direct plays files the browser supports', () => {
    const d = registry().decide(file({ audioCodec: 'aac', audioTracks: [{ index: 1, codec: 'aac', language: 'eng', channels: 2, channelLayout: null, title: null, isDefault: true }] }), CHROME);
    expect(d).toMatchObject({ engine: 'direct', seek: 'range', compatible: true, audioIndex: 1 });
  });

  it('converts unsupported audio (EAC3) while copying the video', () => {
    const d = registry().decide(file(), CHROME)!;
    expect(d).toMatchObject({ engine: 'remux', seek: 'restart', compatible: true, audioIndex: 1, durationSec: 5400, streamUrl: '/api/media/5/remux?audio=1' });
    expect(d.note).toContain('EAC3');
  });

  it('switches to another audio track through the remux engine, copying AAC', () => {
    const d = registry().decide(file({ audioCodec: 'aac', audioTracks: [
      { index: 1, codec: 'aac', language: 'eng', channels: 2, channelLayout: null, title: null, isDefault: true },
      { index: 2, codec: 'aac', language: 'nld', channels: 2, channelLayout: null, title: null, isDefault: false },
    ] }), CHROME, { audioIndex: 2 })!;
    expect(d).toMatchObject({ engine: 'remux', audioIndex: 2, streamUrl: '/api/media/5/remux?audio=2&copy=1', note: null });
  });

  it('keeps direct play (with reasons) when the video codec itself is unsupported', () => {
    const d = registry().decide(file({ videoCodec: 'hevc' }), CHROME)!;
    expect(d.engine).toBe('direct');
    expect(d.compatible).toBe(false);
    expect(d.reasons.join(' ')).toContain('HEVC');
  });

  it('remuxes MKV for browsers without Matroska support (Safari)', () => {
    const safari = { containers: ['mp4', 'mov'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3'] };
    const d = registry().decide(file({ audioCodec: 'aac', audioTracks: [{ index: 1, codec: 'aac', language: null, channels: 2, channelLayout: null, title: null, isDefault: true }] }), safari)!;
    expect(d).toMatchObject({ engine: 'remux', streamUrl: '/api/media/5/remux?audio=1&copy=1' });
  });

  it('plans no remux for non-copyable video', () => {
    expect(planRemux(file({ videoCodec: 'mpeg2video' }), CHROME)).toBeNull();
    expect(planRemux(file({ videoCodec: 'h264' }), {})).toEqual({ audioIndex: 1, copyAudio: false });
  });
});

describe('remux helpers', () => {
  it('builds FFmpeg arguments that copy video and convert audio', () => {
    const args = remuxArgs('/media/a.mkv', 'hevc', { audioIndex: 1, copyAudio: false }, 12.5);
    const s = args.join(' ');
    expect(s).toContain('-ss 12.600 -fflags +genpts -i /media/a.mkv -map 0:v:0 -map 0:1 -c:v copy -tag:v hvc1');
    expect(s).toContain('-c:a aac -ac 2');
    expect(s).toContain('-movflags frag_keyframe+empty_moov+default_base_moof pipe:1');
    expect(remuxArgs('/a.mkv', 'h264', { audioIndex: null, copyAudio: false }, 0)).not.toContain('-ss');
  });

  it('picks the keyframe at or before the target', () => {
    expect(pickKeyframe([0, 10.4, 20.8, 31.2], 25)).toBe(20.8);
    expect(pickKeyframe([0, 10.4], 10.42)).toBe(10.4);
    expect(pickKeyframe([], 5)).toBe(0);
  });

  it('shifts WebVTT cues and drops cues before the new start', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nEarly\n\n00:00:21.000 --> 00:00:23.500 line:90%\nLate\n\n01:00:00.000 --> 01:00:01.000\nHour\n';
    expect(shiftVtt(vtt, 20)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.500 line:90%\nLate\n\n00:59:40.000 --> 00:59:41.000\nHour\n');
    expect(shiftVtt(vtt, 0)).toBe(vtt);
  });
});
