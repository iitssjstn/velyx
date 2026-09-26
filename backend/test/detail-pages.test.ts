import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import type { Prober } from '../src/services/probe.js';

let env: TestEnv;
afterEach(() => env?.cleanup());

const chrome = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264', 'vp9', 'av1'], audioCodecs: ['aac', 'opus', 'mp3'], tenBitCodecs: [], hdr: false };

/** A 4K HDR remux with two audio tracks and an image-based subtitle, and a 1080p copy. */
const prober: Prober = async (file) => {
  if (file.includes('2160p'))
    return fakeProbe({
      videoCodec: 'hevc',
      videoProfile: 'Main 10',
      videoBitDepth: 10,
      videoRange: 'HDR10',
      width: 3840,
      height: 2160,
      bitrate: 24_000_000,
      audioCodec: 'eac3',
      audioChannels: 6,
      audioTracks: [
        { index: 1, codec: 'eac3', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true },
        { index: 2, codec: 'aac', language: 'nld', channels: 2, channelLayout: 'stereo', title: null, isDefault: false },
      ],
      subtitleTracks: [{ index: 3, codec: 'hdmv_pgs_subtitle', language: 'eng', title: null, isDefault: false, isForced: false, textBased: false }],
    });
  return fakeProbe();
};

async function setup(p: Prober = prober) {
  env = await createTestEnv({ prober: p });
  const admin = await setupAdmin(env.app);
  const dir = path.join(env.mediaDir, 'movies', 'Dune (2021)');
  touch(path.join(dir, 'Dune (2021) 2160p.mkv'));
  touch(path.join(dir, 'Dune (2021) 2160p.nl.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHallo\n');
  touch(path.join(dir, 'Dune (2021) 1080p.mkv'));
  await addLibrary(env, admin, 'movies', 'movies');
  const movieId = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items[0].id as number;
  return { admin, movieId };
}

describe('movie detail page', () => {
  it('describes audio, subtitles and technical details per version, best version first', async () => {
    const { admin, movieId } = await setup();
    const m = (await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: admin } })).json();
    expect(m.files.map((f: { height: number }) => f.height)).toEqual([2160, 1080]);
    const [uhd, hd] = m.files;
    expect(uhd).toMatchObject({ videoCodec: 'hevc', videoBitDepth: 10, videoRange: 'HDR10', bitrate: 24_000_000, container: 'mkv' });
    expect(uhd.audioTracks.map((a: { languageName: string; channels: number; codec: string }) => [a.languageName, a.channels, a.codec])).toEqual([
      ['English', 6, 'eac3'],
      ['Dutch', 2, 'aac'],
    ]);
    expect(uhd.embeddedSubtitles).toEqual([expect.objectContaining({ languageName: 'English', textBased: false })]);
    expect(uhd.externalSubtitles).toEqual([expect.objectContaining({ language: 'nl', format: 'srt' })]);
    expect(hd).toMatchObject({ videoCodec: 'h264', videoRange: 'SDR', externalSubtitles: [] });
  });

  it('checks playback for this device from stored details, without analysing the file again', async () => {
    const { admin, movieId } = await setup();
    const probed = env.probeCalls.length;
    const [uhd, hd] = (await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: admin } })).json().files;
    const check = async (id: number) => (await env.app.inject({ method: 'POST', url: `/api/media/${id}/playback`, headers: { cookie: admin }, payload: chrome })).json();
    expect((await check(hd.id)).analysis).toMatchObject({ mode: 'direct', serverTranscoding: false });
    const u = (await check(uhd.id)).analysis;
    expect(u.mode).toBe('unsupported');
    expect(u.components.video.status).toBe('fail');
    // Opening the page repeatedly never runs FFprobe.
    for (let i = 0; i < 3; i++) await check(uhd.id);
    expect(env.probeCalls.length).toBe(probed);
    // Checking is not playing: no stream or history is recorded.
    expect(env.ctx.streams.active()).toEqual([]);
  });

  it('analyses a file from an older version at most once, even when that gives no answer', async () => {
    let calls = 0;
    const counting: Prober = async () => {
      calls++;
      return fakeProbe({ videoBitDepth: null });
    };
    const { admin, movieId } = await setup(counting);
    const fileId = (await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: admin } })).json().files[0].id;
    const before = calls;
    for (let i = 0; i < 4; i++) {
      const res = await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: chrome });
      expect(res.statusCode).toBe(200);
    }
    expect(calls - before).toBe(1);
  });

  it('only shows details and playback checks to users who may see the library', async () => {
    const { admin, movieId } = await setup();
    const fileId = (await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: admin } })).json().files[0].id;
    const anna = await createUser(env.app, admin, 'anna');
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [] } });
    expect((await env.app.inject({ url: `/api/movies/${movieId}`, headers: { cookie: anna.cookie } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: anna.cookie }, payload: chrome })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, payload: chrome })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: { videoCodecs: 'h264' } })).statusCode).toBe(400);
  });
});
