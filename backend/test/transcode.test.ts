import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles } from '../src/db/schema.js';
import { detectEncoders, encodeArgs, pickEncoder } from '../src/playback/transcode.js';
import { remuxArgs } from '../src/playback/remux.js';

let env: TestEnv;
afterEach(async () => env?.cleanup());

describe('video encoders', () => {
  it('builds H.264 arguments for the processor, Intel/AMD and NVIDIA', () => {
    expect(encodeArgs('software').output).toContain('libx264');
    expect(encodeArgs('nvenc').output).toContain('h264_nvenc');
    const vaapi = encodeArgs('vaapi', '/dev/dri/renderD129');
    expect(vaapi.input).toEqual(['-vaapi_device', '/dev/dri/renderD129']);
    expect(vaapi.output).toContain('h264_vaapi');
    // Never scaled down: the source's own resolution.
    for (const e of ['software', 'vaapi', 'nvenc'] as const) expect(encodeArgs(e).output.join(' ')).not.toMatch(/scale/);
  });

  it('picks the fastest encoder that works, or the chosen one only when it works', () => {
    const support = { software: true, vaapi: '/dev/dri/renderD128', nvenc: false, checkedAt: 0 };
    expect(pickEncoder('auto', support)).toBe('vaapi');
    expect(pickEncoder('auto', { ...support, nvenc: true })).toBe('nvenc');
    expect(pickEncoder('auto', { ...support, vaapi: null })).toBe('software');
    expect(pickEncoder('nvenc', support)).toBeNull();
    expect(pickEncoder('software', support)).toBe('software');
    expect(pickEncoder('auto', { software: false, vaapi: null, nvenc: false, checkedAt: 0 })).toBeNull();
  });

  it('tries each encoder instead of trusting that it is listed', async () => {
    const tried: string[] = [];
    const support = await detectEncoders(
      'ffmpeg',
      async (args) => {
        tried.push(args.join(' '));
        return args.includes('libx264') || args.includes('/dev/dri/renderD129');
      },
      ['/dev/dri/renderD128', '/dev/dri/renderD129'],
    );
    expect(support).toMatchObject({ software: true, nvenc: false, vaapi: '/dev/dri/renderD129' });
    expect(tried.some((t) => t.includes('h264_nvenc'))).toBe(true);
  });

  it('re-encodes the video in the same stream a remux would be, seeking the same way', () => {
    const plan = { audioIndex: 1, copyAudio: false, channels: 2 };
    const copy = remuxArgs('/m/a.mkv', 'hevc', plan, 30);
    const transcode = remuxArgs('/m/a.mkv', 'mpeg2video', plan, 30, encodeArgs('vaapi', '/dev/dri/renderD128'));
    expect(copy.join(' ')).toContain('-c:v copy');
    expect(transcode.join(' ')).not.toContain('-c:v copy');
    expect(transcode.indexOf('-vaapi_device')).toBeLessThan(transcode.indexOf('-i'));
    expect(transcode.join(' ')).toContain('-noaccurate_seek -ss 30.000');
    expect(transcode.join(' ')).toContain('frag_keyframe');
  });
});

describe('converting video an administrator turned on', () => {
  async function setup() {
    env = await createTestEnv({
      prober: async (file) => (file.includes('Mpeg2') ? fakeProbe({ container: 'mp4', videoCodec: 'mpeg2video', audioCodec: 'ac3' }) : fakeProbe({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' })),
    });
    const admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'movies', 'Old Mpeg2 (1999).mp4'), 'z'.repeat(4096));
    touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mp4'), 'x'.repeat(4096));
    await addLibrary(env, admin, 'movies', 'movies');
    const file = (name: string) => env.ctx.db.select().from(mediaFiles).all().find((f) => f.path.includes(name))!;
    return { admin, mpeg2: file('Mpeg2'), dune: file('Dune') };
  }
  const chrome = { containers: ['mp4', 'webm'], videoCodecs: ['h264', 'vp9'], audioCodecs: ['aac', 'mp3', 'opus'] };
  const playback = (cookie: string, id: number) => env.app.inject({ method: 'POST', url: `/api/media/${id}/playback`, headers: { cookie }, payload: chrome });
  const configure = (cookie: string, payload: object) => env.app.inject({ method: 'PUT', url: '/api/admin/transcoding', headers: { cookie }, payload });

  it('is off by default: video the device cannot play is explained, not converted', async () => {
    const { admin, mpeg2 } = await setup();
    const res = (await playback(admin, mpeg2.id)).json();
    expect(res.analysis.mode).toBe('unsupported');
    expect(res.analysis.summary.join(' ')).toContain('Admin → Server');
    const stream = await env.app.inject({ url: `/api/media/${mpeg2.id}/remux?audio=1&vt=1`, headers: { cookie: admin } });
    expect(stream.statusCode).toBe(403);
  });

  it('when on, converts only what does not play otherwise', async () => {
    const { admin, mpeg2, dune } = await setup();
    const on = await configure(admin, { enabled: true, encoder: 'auto', maxStreams: null });
    expect(on.json()).toMatchObject({ settings: { enabled: true, encoder: 'auto', maxStreams: null }, inUse: 'software' });
    const res = (await playback(admin, mpeg2.id)).json();
    expect(res.decision).toMatchObject({ engine: 'transcode', seek: 'restart', compatible: true });
    expect(res.decision.streamUrl).toMatch(/\/remux\?audio=\d+.*&vt=1$/);
    expect(res.analysis).toMatchObject({ mode: 'transcode', serverTranscoding: true, serverLoad: 'high', video: { action: 'transcode' } });
    // A file the browser plays as it is stays untouched.
    expect((await playback(admin, dune.id)).json().decision.engine).toBe('direct');
    // A Chromecast gets the converted stream too.
    const cast = await env.app.inject({ method: 'POST', url: '/api/cast/session', headers: { cookie: admin }, payload: { fileId: mpeg2.id } });
    expect(cast.json().decision.engine).toBe('transcode');
  });

  it('only lets administrators change it, and checks the values', async () => {
    const { admin } = await setup();
    expect((await configure(admin, { enabled: true, encoder: 'quicksync', maxStreams: null })).statusCode).toBe(400);
    expect((await configure(admin, { enabled: true, encoder: 'auto', maxStreams: 0 })).statusCode).toBe(400);
    expect((await configure(admin, { enabled: true, encoder: 'auto', maxStreams: 3 })).json().settings.maxStreams).toBe(3);
    expect((await env.app.inject({ url: '/api/admin/transcoding' })).statusCode).toBe(401);
  });

  it('does not convert when the chosen encoder does not work here', async () => {
    const { admin, mpeg2 } = await setup();
    const res = (await configure(admin, { enabled: true, encoder: 'nvenc', maxStreams: null })).json();
    expect(res.inUse).toBeNull();
    expect((await playback(admin, mpeg2.id)).json().analysis.mode).toBe('unsupported');
  });
});
