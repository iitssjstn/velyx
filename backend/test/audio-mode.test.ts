import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles } from '../src/db/schema.js';

let env: TestEnv;
afterEach(async () => env?.cleanup());

async function setup() {
  env = await createTestEnv({ prober: async () => fakeProbe({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }) });
  const admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mp4'), 'x'.repeat(4096));
  await addLibrary(env, admin, 'movies', 'movies');
  return { admin, dune: env.ctx.db.select().from(mediaFiles).get()! };
}
const setMode = (cookie: string, audioMode: unknown) => env.app.inject({ method: 'PUT', url: '/api/account/preferences', headers: { cookie }, payload: { audioMode } });
const playback = async (cookie: string, id: number, payload: object = {}) =>
  (await env.app.inject({ method: 'POST', url: `/api/media/${id}/playback`, headers: { cookie }, payload })).json().decision as { engine: string; streamUrl: string };

describe('audio mode (voices boosted, night) per account', () => {
  it('is stored with the account: normal by default, voices or night', async () => {
    const { admin } = await setup();
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie: admin } })).json().audioMode).toBe('normal');
    expect((await setMode(admin, 'night')).json().audioMode).toBe('night');
    expect((await env.app.inject({ url: '/api/account/preferences', headers: { cookie: admin } })).json().audioMode).toBe('night');
    expect((await setMode(admin, 'loud')).statusCode).toBe(400);
  });

  it('converts the audio of every title for that account, unless the player asks otherwise', async () => {
    const { admin, dune } = await setup();
    const viewer = await createUser(env.app, admin, 'viewer');
    // Normal: an MP4 with AAC plays as it is.
    expect((await playback(admin, dune.id)).engine).toBe('direct');

    await setMode(admin, 'voices');
    const voices = await playback(admin, dune.id);
    expect(voices.engine).toBe('remux');
    expect(voices.streamUrl).toContain('voice=1');
    expect(voices.streamUrl).not.toContain('level=1');

    await setMode(admin, 'night');
    const night = await playback(admin, dune.id);
    expect(night.streamUrl).toContain('voice=1');
    expect(night.streamUrl).toContain('level=1');

    // An explicit choice of the player wins; other accounts are not touched.
    expect((await playback(admin, dune.id, { boostVoices: false, levelVolume: false })).engine).toBe('direct');
    expect((await playback(viewer.cookie, dune.id)).engine).toBe('direct');
  });

  it('also counts when casting (the TV gets the boosted audio)', async () => {
    const { admin, dune } = await setup();
    const cast = async () => (await env.app.inject({ method: 'POST', url: '/api/cast/session', headers: { cookie: admin }, payload: { fileId: dune.id } })).json();
    expect((await cast()).decision.engine).toBe('direct');
    await setMode(admin, 'night');
    const boosted = await cast();
    expect(boosted.decision.engine).toBe('remux');
    expect(boosted.decision.streamUrl).toContain('/hls/index.m3u8?');
    expect(boosted.decision.streamUrl).toContain('voice=1');
    expect(boosted.decision.streamUrl).toContain('level=1');
  });
});
