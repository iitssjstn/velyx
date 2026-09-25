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
