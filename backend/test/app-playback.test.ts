import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import type { ProbeResult } from '../src/services/probe.js';

const APP_UA = 'VidaluneApp/1.0 (Android 14; Pixel 8)';
/** What a typical Android phone reports through the app (ExoPlayer decoders). */
const PHONE = {
  containers: ['mp4', 'mkv', 'webm'],
  videoCodecs: ['h264', 'hevc', 'vp9'],
  tenBitCodecs: ['hevc'],
  audioCodecs: ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3'],
  hdr: true,
  audioTrackSwitching: true,
  imageSubtitles: true,
};

let env: TestEnv;
afterEach(async () => {
  await env?.cleanup();
});

/** One movie whose file has the given format; returns an app token and the file id. */
async function setup(probe: Partial<ProbeResult>) {
  env = await createTestEnv({ prober: async () => fakeProbe(probe) });
  const admin = await setupAdmin(env.app, 'admin', 'correct-horse');
  touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
  await addLibrary(env, admin, 'movies', 'movies');
  const login = await env.app.inject({ method: 'POST', url: '/api/auth/app/login', headers: { 'user-agent': APP_UA }, payload: { username: 'admin', password: 'correct-horse', deviceName: 'Pixel 8' } });
  const token = login.json().token as string;
  const movie = (await env.app.inject({ url: '/api/movies', headers: { authorization: `Bearer ${token}` } })).json().items[0];
  const fileId = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { authorization: `Bearer ${token}` } })).json().files[0].id as number;
  return { admin, token, fileId };
}

const playback = (token: string, fileId: number, body: object) =>
  env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { authorization: `Bearer ${token}`, 'user-agent': APP_UA }, payload: body });

const twoAudioTracks = [
  { index: 1, codec: 'eac3', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true },
  { index: 2, codec: 'ac3', language: 'nld', channels: 2, channelLayout: 'stereo', title: null, isDefault: false },
];

describe('playing from the Vidalune app', () => {
  it('plays what the phone reports directly: 10-bit HEVC HDR in MKV with Dolby audio, no remux', async () => {
    const { token, fileId } = await setup({ container: 'mkv', videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', audioCodec: 'eac3', audioTracks: [twoAudioTracks[0]!] });
    const res = (await playback(token, fileId, PHONE)).json();
    expect(res.decision).toMatchObject({ engine: 'direct', mode: 'direct', streamUrl: `/api/media/${fileId}/stream` });
    expect(res.analysis).toMatchObject({ mode: 'direct', device: 'Vidalune app on Pixel 8', confidence: 'reported', problems: [] });
  });

  it('switches audio tracks in the original file instead of remuxing', async () => {
    const { token, fileId } = await setup({ audioCodec: 'eac3', audioTracks: twoAudioTracks });
    const app = (await playback(token, fileId, { ...PHONE, audioIndex: 2 })).json();
    expect(app.decision).toMatchObject({ engine: 'direct', audioIndex: 2 });
    // A player that cannot switch tracks gets the remux, as browsers do.
    const noSwitch = (await playback(token, fileId, { ...PHONE, audioTrackSwitching: false, audioIndex: 2 })).json();
    expect(noSwitch.decision.engine).toBe('remux');
    // A track the phone cannot decode is converted.
    const noAc3 = (await playback(token, fileId, { ...PHONE, audioCodecs: ['aac', 'eac3'], audioIndex: 2 })).json();
    expect(noAc3.decision.engine).toBe('remux');
  });

  it('plays 10-bit H.264 when the device decodes it, which no browser does', async () => {
    const { token, fileId } = await setup({ videoCodec: 'h264', videoBitDepth: 10 });
    const yes = (await playback(token, fileId, { ...PHONE, tenBitCodecs: ['hevc', 'h264'] })).json();
    expect(yes.analysis.mode).toBe('direct');
    const no = (await playback(token, fileId, PHONE)).json();
    expect(no.analysis.mode).toBe('unsupported');
  });

  it('does not warn about image subtitles the app shows itself', async () => {
    const pgs = [{ index: 3, codec: 'hdmv_pgs_subtitle', language: 'nld', title: null, isDefault: false, isForced: false, textBased: false }] as ProbeResult['subtitleTracks'];
    const { token, fileId } = await setup({ subtitleTracks: pgs });
    const app = (await playback(token, fileId, PHONE)).json();
    expect(app.analysis.warnings.join(' ')).not.toMatch(/image-based/);
    const other = (await playback(token, fileId, { ...PHONE, imageSubtitles: false })).json();
    expect(other.analysis.warnings.join(' ')).toMatch(/image-based/);
  });

  it('assumes what every Android device plays when the app sends no report', async () => {
    const { token, fileId } = await setup({ videoCodec: 'h264', audioCodec: 'aac', container: 'mkv' });
    await env.app.inject({ method: 'PUT', url: '/api/account/language', headers: { authorization: `Bearer ${token}` }, payload: { language: 'nl' } });
    const res = (await playback(token, fileId, {})).json();
    expect(res.analysis).toMatchObject({ mode: 'direct', confidence: 'profile', device: 'Vidalune-app op Pixel 8' });
  });

  it('shows the app device in the activity overview', async () => {
    const { admin, token, fileId } = await setup({});
    await env.app.inject({ url: `/api/media/${fileId}/stream`, headers: { authorization: `Bearer ${token}`, range: 'bytes=0-0' } });
    const activity = (await env.app.inject({ url: '/api/admin/activity', headers: { cookie: admin } })).json();
    expect(activity.streams[0]).toMatchObject({ device: 'Vidalune app on Pixel 8', mode: 'direct' });
  });
});
