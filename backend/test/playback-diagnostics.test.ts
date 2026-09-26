import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const CHROME = { containers: ['mp4', 'webm'], videoCodecs: ['h264', 'vp9', 'av1'], audioCodecs: ['aac', 'mp3', 'opus', 'flac'] };

async function playback(probe: Parameters<typeof fakeProbe>[0]) {
  env = await createTestEnv({ prober: async () => fakeProbe(probe) });
  const cookie = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mkv'));
  await addLibrary(env, cookie, 'movies', 'movies');
  const movie = (await env.app.inject({ url: '/api/movies', headers: { cookie } })).json().items[0];
  const fileId = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie } })).json().files[0].id;
  const res = await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie }, payload: CHROME });
  expect(res.statusCode).toBe(200);
  return res.json().analysis;
}

describe('playback details', () => {
  it('include the bitrate FFprobe measured', async () => {
    const a = await playback({ container: 'mp4', bitrate: 24_000_000 });
    expect(a).toMatchObject({ mode: 'direct', bitrate: 24_000_000, serverTranscoding: false });
  });

  it('say what converted audio becomes, and why the file is remuxed', async () => {
    const a = await playback({ container: 'mkv', audioCodec: 'dts', audioChannels: 6, audioTracks: [{ index: 1, codec: 'dts', language: 'eng', channels: 6, channelLayout: '5.1', title: null, isDefault: true }] });
    expect(a.mode).toBe('remux');
    expect(a.audio).toMatchObject({ codec: 'dts', action: 'convert', target: expect.stringMatching(/^AAC/) });
    expect(a.summary.length).toBeGreaterThan(0);
    expect(a.video.action).toBe('copy');
  });
});
