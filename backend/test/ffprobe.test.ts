import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFfprobe } from '../src/services/probe.js';
import { addLibrary, createTestEnv, setupAdmin, type TestEnv } from './helpers.js';

function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = hasBinary('ffprobe') && hasBinary('ffmpeg');

/** End-to-end check with the real FFprobe/FFmpeg binaries (skipped when they are not installed). */
describe.skipIf(!available)('real FFprobe / FFmpeg', () => {
  let env: TestEnv;
  let admin: string;

  beforeAll(async () => {
    env = await createTestEnv({ prober: createFfprobe('ffprobe') });
    admin = await setupAdmin(env.app);
    const dir = path.join(env.mediaDir, 'movies', 'Tiny Film (2020)');
    fs.mkdirSync(dir, { recursive: true });
    const srt = path.join(env.dir, 'embedded.srt');
    fs.writeFileSync(srt, '1\n00:00:00,100 --> 00:00:01,500\nEmbedded line\n');
    execFileSync('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-i', srt,
      '-map', '0', '-map', '1', '-map', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=eng', '-metadata:s:s:0', 'language=eng',
      path.join(dir, 'Tiny Film (2020).mkv'),
    ]);
    await addLibrary(env, admin, 'movies', 'movies');
  }, 60000);

  afterAll(async () => {
    await env?.cleanup();
  });

  it('reads real media information', async () => {
    const [movie] = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items;
    const detail = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie: admin } })).json();
    const f = detail.files[0];
    expect(f).toMatchObject({ container: 'mkv', videoCodec: 'h264', width: 320, height: 240, audioCodec: 'aac', probeError: null });
    expect(f.fps).toBe(25);
    expect(f.durationSec).toBeGreaterThan(1.5);
    expect(f.embeddedSubtitles[0]).toMatchObject({ codec: 'subrip', language: 'eng', textBased: true });
  });

  it('extracts embedded text subtitles as WebVTT', async () => {
    const [movie] = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items;
    const detail = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie: admin } })).json();
    const subs = (await env.app.inject({ url: `/api/media/${detail.files[0].id}/subtitles`, headers: { cookie: admin } })).json();
    const emb = subs.find((s: { kind: string }) => s.kind === 'embedded');
    const vtt = await env.app.inject({ url: emb.url, headers: { cookie: admin } });
    expect(vtt.statusCode).toBe(200);
    expect(vtt.body).toContain('WEBVTT');
    expect(vtt.body).toContain('Embedded line');
  }, 30000);
});

/** Live remux with the real binaries: EAC3/AC3 audio converted to AAC, video copied, seeking. */
describe.skipIf(!available)('remux streaming (real FFmpeg)', () => {
  let env: TestEnv;
  let admin: string;
  let fileId: number;

  beforeAll(async () => {
    env = await createTestEnv({ prober: createFfprobe('ffprobe') });
    admin = await setupAdmin(env.app);
    const dir = path.join(env.mediaDir, 'movies');
    fs.mkdirSync(dir, { recursive: true });
    const srt = path.join(env.dir, 'late.srt');
    fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,000\nEarly\n\n2\n00:00:05,000 --> 00:00:06,000\nLate line\n');
    execFileSync('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=8',
      '-i', srt,
      '-map', '0', '-map', '1', '-map', '2', '-map', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50',
      '-c:a:0', 'eac3', '-c:a:1', 'aac', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=nld', '-metadata:s:s:0', 'language=eng',
      path.join(dir, 'Dolby Film (2021).mkv'),
    ]);
    await addLibrary(env, admin, 'movies', 'movies');
    const [movie] = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items;
    fileId = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie: admin } })).json().files[0].id;
  }, 60000);

  afterAll(async () => {
    await env?.cleanup();
  });

  const chrome = { containers: ['mp4', 'webm', 'mkv'], videoCodecs: ['h264', 'vp9'], audioCodecs: ['aac', 'mp3', 'opus'] };

  it('chooses the remux engine for EAC3 audio', async () => {
    const res = await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: chrome });
    expect(res.json().decision).toMatchObject({ engine: 'remux', seek: 'restart', audioIndex: 1 });
    const other = await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: { ...chrome, audioIndex: 2 } });
    expect(other.json().decision).toMatchObject({ engine: 'remux', audioIndex: 2, streamUrl: `/api/media/${fileId}/remux?audio=2&copy=1` });
    const bad = await env.app.inject({ method: 'POST', url: `/api/media/${fileId}/playback`, headers: { cookie: admin }, payload: { ...chrome, audioIndex: 9 } });
    expect(bad.statusCode).toBe(400);
  });

  it('streams fragmented MP4 with AAC audio and copied H.264 video', async () => {
    const res = await env.app.inject({ url: `/api/media/${fileId}/remux?audio=1`, headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    const out = path.join(env.dir, 'out.mp4');
    fs.writeFileSync(out, res.rawPayload);
    expect(res.rawPayload.subarray(4, 8).toString()).toBe('ftyp');
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out]).toString().trim().split('\n');
    expect(streams).toEqual(['h264', 'aac']);
  }, 30000);

  it('reports where a seeked stream really starts, and that stream matches it', async () => {
    const kf = (await env.app.inject({ url: `/api/media/${fileId}/keyframe?t=5.3`, headers: { cookie: admin } })).json();
    expect(kf.seek).toBe(5.3);
    expect(kf.start).toBeLessThanOrEqual(5.3);
    expect(kf.start).toBeGreaterThanOrEqual(2);
    const res = await env.app.inject({ url: `/api/media/${fileId}/remux?audio=1&start=${kf.seek}`, headers: { cookie: admin } });
    const out = path.join(env.dir, 'seek.mp4');
    fs.writeFileSync(out, res.rawPayload);
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    // The stream covers exactly [landing, end of file] (8 s source).
    expect(Math.abs(dur - (8 - kf.start))).toBeLessThan(0.25);
    const audio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', out]).toString().trim().split('\n').map(Number);
    expect(audio[0]).toBeLessThan(0.1); // audio starts together with the video, no leading gap
    const subs = (await env.app.inject({ url: `/api/media/${fileId}/subtitles`, headers: { cookie: admin } })).json();
    const vtt = await env.app.inject({ url: `${subs[0].url}?offset=${kf.start}`, headers: { cookie: admin } });
    expect(vtt.body).not.toContain('Early');
    expect(vtt.body).toContain('Late line');
  }, 30000);

  it('keeps converted audio continuous when the source has timestamp gaps', async () => {
    const gapped = path.join(env.mediaDir, 'movies', 'Gap Film (2022).mkv');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'eac3', path.join(env.dir, 'src.mkv')]);
    execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(env.dir, 'src.mkv'), '-map', '0', '-c', 'copy', '-bsf:a', "noise=drop='between(pts*tb,2,2.5)'", gapped]);
    await env.ctx.scans.enqueue((await env.app.inject({ url: '/api/libraries', headers: { cookie: admin } })).json().libraries[0].id);
    await env.ctx.scans.whenIdle();
    const list = (await env.app.inject({ url: '/api/search?q=gap', headers: { cookie: admin } })).json();
    const id = (await env.app.inject({ url: `/api/movies/${list.movies[0].id}`, headers: { cookie: admin } })).json().files[0].id;
    const res = await env.app.inject({ url: `/api/media/${id}/remux?audio=1&ch=2`, headers: { cookie: admin } });
    const out = path.join(env.dir, 'gap.mp4');
    fs.writeFileSync(out, res.rawPayload);
    const ts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', out]).toString().trim().split('\n').map(Number);
    const jumps = ts.slice(2).filter((t, i) => t - ts[i + 1]! > 0.05);
    expect(jumps).toEqual([]);
  }, 60000);

  it('applies voice boost and volume levelling with the real FFmpeg filters', async () => {
    const res = await env.app.inject({ url: `/api/media/${fileId}/remux?audio=1&ch=2&voice=1&level=1`, headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const out = path.join(env.dir, 'fx.mp4');
    fs.writeFileSync(out, res.rawPayload);
    const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', out]).toString().trim().split('\n');
    expect(info).toEqual(['h264', 'aac,2']);
  }, 30000);

  it('rejects invalid remux parameters', async () => {
    for (const q of ['audio=7', 'audio=1&start=-3', 'audio=1&start=abc', 'audio=1&start=99999', 'audio=1&ch=8']) {
      const res = await env.app.inject({ url: `/api/media/${fileId}/remux?${q}`, headers: { cookie: admin } });
      expect(res.statusCode, q).toBe(400);
    }
    expect((await env.app.inject({ url: `/api/media/${fileId}/remux?audio=1` })).statusCode).toBe(401);
    const subs = (await env.app.inject({ url: `/api/media/${fileId}/subtitles`, headers: { cookie: admin } })).json();
    expect((await env.app.inject({ url: `${subs[0].url}?offset=-1`, headers: { cookie: admin } })).statusCode).toBe(400);
  });
});
