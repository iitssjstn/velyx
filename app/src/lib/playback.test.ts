import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { endedEarly, playbackCaps, resumePoint, playerAudioPosition, streamFrom, subtitleUrl, type PlaybackAnswer, type SubtitleOption } from './playback';
import { cueTextAt, parseVtt } from './vtt';

const api = (respond: (url: string) => unknown = () => ({})) =>
  createApi({
    baseUrl: 'http://velyx.local',
    token: 't',
    userAgent: 'x',
    fetchImpl: vi.fn(async (url: string) => new Response(JSON.stringify(respond(url)), { status: 200 })) as unknown as typeof fetch,
  });

const answer = (seek: 'range' | 'restart', streamUrl: string): PlaybackAnswer => ({
  decision: { engine: seek === 'range' ? 'direct' : 'remux', mode: seek === 'range' ? 'direct' : 'remux', streamUrl, compatible: true, seek, audioIndex: 1, durationSec: 3600 },
  analysis: { mode: 'direct', problems: [], summary: [] },
  file: { id: 7, durationSec: 3600, audioTracks: [] },
  subtitles: [],
});

describe('what the app reports', () => {
  it('passes on the device decoders, with the containers the player reads', () => {
    const caps = playbackCaps({ videoCodecs: ['h264', 'hevc', 'hevc'], tenBitCodecs: ['hevc'], audioCodecs: ['aac', 'eac3'], hdr: true }, 2);
    expect(caps).toEqual({
      containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'ts', 'avi'],
      videoCodecs: ['h264', 'hevc'],
      tenBitCodecs: ['hevc'],
      audioCodecs: ['aac', 'eac3'],
      hdr: true,
      audioTrackSwitching: true,
      imageSubtitles: false,
      audioIndex: 2,
    });
  });

  it('falls back to what every Android device plays without a decoder report', () => {
    expect(playbackCaps(null)).toMatchObject({ videoCodecs: ['h264', 'vp8', 'vp9'], tenBitCodecs: [], hdr: false });
    expect(playbackCaps(null)).not.toHaveProperty('audioIndex');
  });
});

describe('where a stream starts', () => {
  it('plays the file itself for direct play, from wherever the player seeks', async () => {
    expect(await streamFrom(api(), answer('range', '/api/media/7/stream'), 600)).toEqual({ uri: 'http://velyx.local/api/media/7/stream', offset: 0 });
  });

  it('starts a remux stream at the keyframe the server names, and offsets positions by it', async () => {
    const a = api((url) => (url.includes('/keyframe?t=600.000') ? { start: 598.5, seek: 600 } : {}));
    expect(await streamFrom(a, answer('restart', '/api/media/7/remux?audio=1&ch=2'), 600)).toEqual({ uri: 'http://velyx.local/api/media/7/remux?audio=1&ch=2&start=600.000', offset: 598.5 });
    expect(await streamFrom(a, answer('restart', '/api/media/7/remux?audio=1'), 0)).toEqual({ uri: 'http://velyx.local/api/media/7/remux?audio=1', offset: 0 });
  });

  it('shifts subtitles along with a stream that starts later', () => {
    const sub = { url: '/api/subtitles/3.vtt' } as SubtitleOption;
    expect(subtitleUrl(api(), sub, 0)).toBe('http://velyx.local/api/subtitles/3.vtt');
    expect(subtitleUrl(api(), sub, 598.5)).toBe('http://velyx.local/api/subtitles/3.vtt?offset=598.500');
  });
});

describe('tracks', () => {
  it('finds the player track for a file audio track', () => {
    const tracks = [
      { index: 3, codec: 'ac3', language: 'nld', channels: 2, title: null, isDefault: false },
      { index: 1, codec: 'eac3', language: 'eng', channels: 6, title: null, isDefault: true },
    ];
    expect(playerAudioPosition(tracks, 1)).toBe(0);
    expect(playerAudioPosition(tracks, 3)).toBe(1);
    expect(playerAudioPosition(tracks, 9)).toBe(-1);
  });

  it('resumes like the website: not in the first 30 seconds, not in the last part', () => {
    expect(resumePoint({ positionSec: 600, durationSec: 2600 })).toBe(600);
    expect(resumePoint({ positionSec: 20, durationSec: 2600 })).toBeNull();
    // In the credits (last 10 %) or the last 15 seconds: start over instead of landing at the end.
    expect(resumePoint({ positionSec: 2400, durationSec: 2600 })).toBeNull();
    expect(resumePoint({ positionSec: 590, durationSec: 600 })).toBeNull();
    expect(resumePoint({ positionSec: 600, durationSec: 2600, completed: true })).toBeNull();
    expect(resumePoint(null)).toBeNull();
  });
});

describe('subtitles', () => {
  it('reads cues and shows what is on screen at a moment', () => {
    const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500 line:90%\n<i>Hallo</i> daar &amp; hier\n\n00:01:02.000 --> 00:01:04.000\nTot ziens\n\n00:01:03.000 --> 00:01:05.000\n- Doei\n\nbroken --> cue\nx\n');
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hallo daar & hier' },
      { start: 62, end: 64, text: 'Tot ziens' },
      { start: 63, end: 65, text: '- Doei' },
    ]);
    expect(cueTextAt(cues, 2)).toBe('Hallo daar & hier');
    expect(cueTextAt(cues, 3.5)).toBe('');
    expect(cueTextAt(cues, 63.5)).toBe('Tot ziens\n- Doei');
  });

  it('reads hour-less and comma times too', () => {
    expect(parseVtt('WEBVTT\n\n01:02.500 --> 01:03,000\nKort')).toEqual([{ start: 62.5, end: 63, text: 'Kort' }]);
  });
});

describe('a second try', () => {
  it('asks for a repackaged stream with converted audio when the original file failed', async () => {
    const { fallbackCaps } = await import('./playback');
    const caps = playbackCaps({ videoCodecs: ['h264', 'hevc'], tenBitCodecs: ['hevc'], audioCodecs: ['aac', 'eac3', 'dts'], hdr: false }, 2);
    expect(fallbackCaps(caps)).toEqual({ ...caps, containers: ['mp4'], audioCodecs: ['aac'], audioTrackSwitching: false });
  });
});

describe('endedEarly', () => {
  it('treats a stop long before the end as a broken-off stream', () => {
    expect(endedEarly(2768, 3362)).toBe(true);
  });
  it('treats the last seconds as the real end', () => {
    expect(endedEarly(3361, 3362)).toBe(false);
    expect(endedEarly(3340, 3362)).toBe(false);
  });
  it('never with an unknown duration', () => {
    expect(endedEarly(100, 0)).toBe(false);
  });
});

