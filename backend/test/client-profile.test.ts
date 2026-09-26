import { describe, expect, it } from 'vitest';
import { PlaybackRegistry, type ClientCapabilities, type MediaFileRow } from '../src/playback/engine.js';
import { DirectPlayEngine } from '../src/playback/direct-play.js';
import { RemuxEngine } from '../src/playback/remux.js';
import { analyzePlayback } from '../src/playback/compatibility.js';
import { clientProfile, deviceSupport, effectiveCapabilities } from '../src/playback/client-profile.js';
import { createTestEnv, setupAdmin } from './helpers.js';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
};

const CHROME: ClientCapabilities = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'flac'], tenBitCodecs: ['vp9', 'av1'], hdr: false };

function file(over: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: 9, container: 'mkv', videoCodec: 'h264', videoBitDepth: 8, videoRange: 'SDR', width: 1920, height: 1080, audioCodec: 'aac', audioChannels: 2, durationSec: 6000, probeError: null, subtitleTracks: [],
    audioTracks: [{ index: 1, codec: over.audioCodec ?? 'aac', language: 'eng', channels: over.audioChannels ?? 2, channelLayout: null, title: null, isDefault: true }],
    ...over,
  } as MediaFileRow;
}

function analyze(f: MediaFileRow, reported: ClientCapabilities, ua: string) {
  const r = new PlaybackRegistry();
  r.register(new DirectPlayEngine());
  r.register(new RemuxEngine('ffmpeg'));
  const { caps, confidence } = effectiveCapabilities(reported, clientProfile(ua));
  return analyzePlayback(f, caps, r.decide(f, caps)!, ua, confidence);
}

describe('client profiles', () => {
  it('names common browsers and platforms', () => {
    expect(clientProfile(UA.chromeWin)).toMatchObject({ name: 'Chrome on Windows', family: 'chromium', mobile: false });
    expect(clientProfile(UA.edgeWin)).toMatchObject({ name: 'Edge on Windows', family: 'chromium' });
    expect(clientProfile(UA.firefoxLinux)).toMatchObject({ name: 'Firefox on Linux', family: 'firefox' });
    expect(clientProfile(UA.safariMac)).toMatchObject({ name: 'Safari on macOS', family: 'safari' });
    // Every iOS browser is WebKit underneath.
    expect(clientProfile(UA.chromeIphone)).toMatchObject({ name: 'Chrome on iPhone', family: 'ios', mobile: true });
    expect(clientProfile(UA.ipad)).toMatchObject({ name: 'Safari on iPad', family: 'ios' });
    expect(clientProfile(UA.chromeAndroid)).toMatchObject({ name: 'Chrome on Android', family: 'android' });
    expect(clientProfile(UA.samsung)).toMatchObject({ name: 'Samsung Internet on Android', family: 'android' });
    expect(clientProfile(UA.firefoxAndroid)).toMatchObject({ name: 'Firefox on Android', family: 'firefox' });
    expect(clientProfile('curl/8.5')).toMatchObject({ name: 'Unknown device', family: 'unknown' });
    expect(clientProfile(undefined).family).toBe('unknown');
  });

  it("uses the browser's own report, and the profile only when there is none", () => {
    expect(effectiveCapabilities(CHROME, clientProfile(UA.safariMac))).toEqual({ caps: CHROME, confidence: 'reported' });
    const safari = effectiveCapabilities({}, clientProfile(UA.safariMac));
    expect(safari.confidence).toBe('profile');
    expect(safari.caps.containers).not.toContain('mkv');
    expect(safari.caps.videoCodecs).toContain('hevc');
    expect(effectiveCapabilities({}, clientProfile('curl/8'))).toEqual({ caps: {}, confidence: 'assumed' });
  });

  it('decides with the profile when a Safari client reports nothing (MKV is remuxed there)', () => {
    const a = analyze(file({ container: 'mkv', audioCodec: 'ac3', audioChannels: 6 }), {}, UA.safariMac);
    expect(a).toMatchObject({ mode: 'remux', confidence: 'profile', device: 'Safari on macOS' });
    expect(a.summary).toContain('This is an estimate: the device did not report which formats it supports.');
  });

  it('lists what the current device plays, honestly', () => {
    const rows = Object.fromEntries(deviceSupport(CHROME, clientProfile(UA.chromeWin)).map((r) => [r.key, r]));
    expect(rows.h264.support).toBe('yes');
    expect(rows.hevc).toMatchObject({ support: 'no', note: 'Depends on hardware decoding support.' });
    expect(rows.av1.support).toBe('yes');
    expect(rows.dts).toMatchObject({ support: 'converted', note: 'Velyx converts it to AAC while playing.' });
    expect(rows.mkv.support).toBe('yes');
    expect(rows['h264-10'].support).toBe('no');
    expect(rows.hdr.support).toBe('no');
    // With hardware HEVC the browser says so, and the note explains why it may differ elsewhere.
    const hw = Object.fromEntries(deviceSupport({ ...CHROME, videoCodecs: [...CHROME.videoCodecs!, 'hevc'], tenBitCodecs: ['hevc'] }, clientProfile(UA.chromeWin)).map((r) => [r.key, r]));
    expect(hw.hevc).toMatchObject({ support: 'yes', note: 'Uses hardware decoding on this device.' });
    expect(hw.hevc10.support).toBe('yes');
    // A browser without AAC cannot be helped by converting to AAC.
    const noAac = Object.fromEntries(deviceSupport({ ...CHROME, audioCodecs: ['opus'] }, clientProfile(UA.chromeWin)).map((r) => [r.key, r]));
    expect(noAac.aac.support).toBe('no');
    // No report at all: everything is a guess.
    const guess = deviceSupport({}, clientProfile(UA.safariMac));
    expect(guess.find((r) => r.key === 'hevc')!.support).toBe('depends');
    expect(guess.find((r) => r.key === 'mkv')!.support).toBe('converted');
  });
});

describe('playback diagnostics', () => {
  it('Direct Play: every stream ✓ and no conversion', () => {
    const a = analyze(file({ container: 'mp4' }), CHROME, UA.chromeWin);
    expect(a.mode).toBe('direct');
    expect(a.components).toEqual({
      video: { status: 'ok', note: 'Plays as-is' },
      audio: { status: 'ok', note: 'Plays as-is' },
      container: { status: 'ok', note: 'Supported' },
    });
    expect(a.summary).toEqual(['No server-side conversion required.']);
    expect(a.subtitles).toEqual({ text: [], image: [] });
    const withSubs = analyze(file({ container: 'mp4', subtitleTracks: [{ index: 2, codec: 'subrip', textBased: true }, { index: 3, codec: 'hdmv_pgs_subtitle', textBased: false }] as MediaFileRow['subtitleTracks'] }), CHROME, UA.chromeWin);
    expect(withSubs.subtitles).toEqual({ text: ['SRT'], image: ['PGS'] });
    expect(a.device).toBe('Chrome on Windows');
  });

  it('Remux: video ✓, DTS ⚠, MKV ✓', () => {
    const a = analyze(file({ audioCodec: 'dts', audioChannels: 6 }), CHROME, UA.chromeWin);
    expect(a.mode).toBe('remux');
    expect(a.components.video).toEqual({ status: 'ok', note: 'Copied without re-encoding' });
    expect(a.components.audio).toEqual({ status: 'warn', note: 'Converted to AAC stereo' });
    expect(a.components.container.status).toBe('ok');
    expect(a.summary[0]).toBe('The video does not need transcoding.');
    expect(a.summary[1]).toMatch(/converts the audio to AAC stereo/);
  });

  it('Unsupported: AV1 ✕ with the audio still fine and no transcoding', () => {
    const noAv1 = { ...CHROME, videoCodecs: ['h264', 'vp9'], tenBitCodecs: ['vp9'] };
    const a = analyze(file({ videoCodec: 'av1' }), noAv1, UA.firefoxLinux);
    expect(a.mode).toBe('unsupported');
    expect(a.components.video.status).toBe('fail');
    expect(a.components.video.note).toMatch(/cannot decode AV1/);
    expect(a.components.audio).toEqual({ status: 'ok', note: 'Supported' });
    expect(a.components.container.status).toBe('ok');
    expect(a.summary).toEqual(['Your current browser/device cannot play this video format.', 'Server transcoding: No. Velyx does not convert video.']);
  });

  it('does not claim certainty it does not have', () => {
    // No report and an unknown client: HEVC may or may not play.
    const a = analyze(file({ videoCodec: 'hevc', container: 'mp4' }), {}, 'SomeTV/1.0');
    expect(a.confidence).toBe('assumed');
    expect(a.components.video.status).toBe('unknown');
    expect(a.summary.join(' ')).toMatch(/cannot confirm|may not be able/);
    expect(a.summary.join(' ')).not.toMatch(/cannot play this video format\./);
  });
});

describe('current device endpoint', () => {
  it('reports the device and its formats for signed-in users', async () => {
    const env = await createTestEnv();
    try {
      const admin = await setupAdmin(env.app);
      const res = await env.app.inject({ method: 'POST', url: '/api/playback/device', headers: { cookie: admin, 'user-agent': UA.edgeWin }, payload: CHROME });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ device: 'Edge on Windows', family: 'chromium', confidence: 'reported' });
      expect(body.formats.find((f: { key: string }) => f.key === 'truehd').support).toBe('converted');
      expect((await env.app.inject({ method: 'POST', url: '/api/playback/device', payload: CHROME })).statusCode).toBe(401);
      expect((await env.app.inject({ method: 'POST', url: '/api/playback/device', headers: { cookie: admin }, payload: { videoCodecs: 'h264' } })).statusCode).toBe(400);
    } finally {
      await env.cleanup();
    }
  });
});
