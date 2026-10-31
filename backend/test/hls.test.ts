import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HlsSessions, KeyframesStopped, copyLayout, gridLayout, hlsArgs, playlist, readKeyframes, type HlsSource } from '../src/playback/hls.js';
import type { RemuxPlan } from '../src/playback/remux.js';
import { encodeArgs } from '../src/playback/transcode.js';
import { createTestEnv, createUser, setupAdmin } from './helpers.js';

let dir: string;
let mkv: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-hls-'));
  mkv = path.join(dir, 'Show.S01E01.mkv');
  // 30 s of H.264 with a keyframe every 3 s, and AC3 audio (which browsers do not play): a typical MKV.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '75', '-keyint_min', '75', '-sc_threshold', '0', '-c:a', 'ac3', '-y', mkv]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const plan: RemuxPlan = { audioIndex: 1, copyAudio: false, channels: 2, sourceChannels: 1 };
const startOf = (files: string[]) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', `concat:${files.join('|')}`]).toString().trim());

describe('HLS pieces', () => {
  it('cuts copied video from keyframe to keyframe, read from the index', async () => {
    const keyframes = await readKeyframes('ffprobe', mkv);
    expect(keyframes.map((t) => Math.round(t))).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
    const layout = copyLayout(keyframes, 30);
    expect(layout.starts).toHaveLength(10);
    const list = playlist(layout, '?audio=1&ch=2');
    expect(list).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(list).toContain('#EXT-X-MAP:URI="init.mp4?audio=1&ch=2"');
    expect(list).toContain('seg/9.m4s?audio=1&ch=2');
    expect(list.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
    expect(list.match(/#EXTINF:/g)).toHaveLength(10);
  });

  it('cuts converted video on a 4-second grid, with a keyframe forced at each piece', () => {
    expect(gridLayout(10).starts).toEqual([0, 4, 8]);
    const args = hlsArgs('in.mkv', 'mpeg2video', plan, gridLayout(10), 1, '/tmp/x', { input: [], output: ['-c:v', 'libx264'] });
    expect(args).toContain('-force_key_frames');
    // From piece 1: its own start is the run's first frame (always a keyframe), the next ones are forced.
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('8.000');
    expect(args[args.indexOf('-hls_time') + 1]).toBe('0.01');
    expect(args[args.indexOf('-ss') + 1]).toBe('4.000');
    expect(args).toContain('-sc_threshold');
  });

  it('makes the pieces asked for, also after a jump, each with the file’s own times', async () => {
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache'));
    try {
      const layout = await sessions.layout('1', mkv, 30, false);
      const src: HlsSource = { key: 'u1:1:a', input: mkv, videoCodec: 'h264', plan, layout, encode: null };
      const init = await sessions.init(src);
      const first = await sessions.segment(src, 0);
      expect(startOf([init, first])).toBeLessThan(0.2);
      // A jump far ahead (resuming, skipping): that piece is made, starting where the list says.
      const later = await sessions.segment(src, 7);
      expect(Math.abs(startOf([init, later]) - 21)).toBeLessThan(0.2);
      // The next one follows from the same run.
      const next = await sessions.segment(src, 8);
      expect(Math.abs(startOf([init, next]) - 24)).toBeLessThan(0.2);
      // The audio is converted to AAC (a browser plays it).
      const codecs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', `concat:${init}|${next}`]).toString().trim().split('\n');
      expect(codecs.sort()).toEqual(['aac', 'h264']);
      // Back to the start (pieces in between were never made): a new run, the piece starts at 3 s,
      // and the pieces the earlier run made further on are still handed out whole.
      const back = await sessions.segment(src, 1);
      expect(Math.abs(startOf([init, back]) - 3)).toBeLessThan(0.2);
      const again = await sessions.segment(src, 8);
      expect(Math.abs(startOf([init, again]) - 24)).toBeLessThan(0.2);
    } finally {
      sessions.stopAll();
    }
  });

  it('makes a piece again when the viewer goes back to one that was tidied away', async () => {
    // A keyframe every second: enough pieces for the player to get well past the first ones.
    const long = path.join(dir, 'Long.mkv');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-c:a', 'ac3', '-y', long]);
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-tidy'));
    try {
      const layout = await sessions.layout('9', long, 40, false);
      const src: HlsSource = { key: 'u1:9:a', input: long, videoCodec: 'h264', plan, layout, encode: null };
      const init = await sessions.init(src);
      for (let n = 0; n <= 20; n++) await sessions.segment(src, n);
      // Piece 2 was removed once the player passed piece 10; the run is still going.
      const back = await sessions.segment(src, 2);
      expect(fs.existsSync(back)).toBe(true);
      expect(Math.abs(startOf([init, back]) - 2)).toBeLessThan(0.2);
    } finally {
      sessions.stopAll();
    }
  });

  it('stops a background keyframe read when asked, keeping nothing, unless a viewer waits for it', async () => {
    const kdir = path.join(dir, 'keyframes-stop');
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-s'), kdir);
    try {
      const stop = new AbortController();
      const background = sessions.learn('7:1:1', mkv, stop.signal);
      stop.abort();
      expect(await background.catch((e: unknown) => e)).toBeInstanceOf(KeyframesStopped);
      expect(sessions.ready('7:1:1')).toBe(false);
      expect(fs.readdirSync(kdir)).toEqual([]);
      // A viewer who asks while the background read runs keeps it going.
      const again = new AbortController();
      const read = sessions.learn('8:1:1', mkv, again.signal);
      const viewer = sessions.layout('8:1:1', mkv, 30, false);
      again.abort();
      expect((await viewer).starts).toHaveLength(10);
      await read;
      expect(sessions.ready('8:1:1')).toBe(true);
    } finally {
      sessions.stopAll();
    }
  });

  it('finds the keyframes in the background once, and keeps them for the next start of the server', async () => {
    const kdir = path.join(dir, 'keyframes');
    const first = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-k'), kdir);
    try {
      expect(first.ready('5:1:1')).toBe(false);
      await first.learn('5:1:1', mkv);
      expect(first.ready('5:1:1')).toBe(true);
    } finally {
      first.stopAll();
    }
    // After a restart: known at once, without reading the file (it is gone).
    const second = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-k'), kdir);
    try {
      expect(second.ready('5:1:1')).toBe(true);
      expect((await second.layout('5:1:1', path.join(dir, 'missing.mkv'), 30, false)).starts).toHaveLength(10);
      expect(second.ready('6:1:1')).toBe(false);
    } finally {
      second.stopAll();
    }
  });

  it('converts video into 4-second pieces that start on the grid, also after a jump', async () => {
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-vt'));
    try {
      const layout = await sessions.layout('1', mkv, 30, true);
      const src: HlsSource = { key: 'u1:1:vt', input: mkv, videoCodec: 'h264', plan, layout, encode: encodeArgs('software') };
      const init = await sessions.init(src);
      expect(Math.abs(startOf([init, await sessions.segment(src, 0)]))).toBeLessThan(0.1);
      expect(Math.abs(startOf([init, await sessions.segment(src, 5)]) - 20)).toBeLessThan(0.1);
      expect(Math.abs(startOf([init, await sessions.segment(src, 6)]) - 24)).toBeLessThan(0.1);
    } finally {
      sessions.stopAll();
    }
  });

  it('frees the conversion of a title the viewer moved on from, not another viewer\'s', async () => {
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-moved'));
    try {
      const layout = await sessions.layout('1', mkv, 30, true);
      const mine: HlsSource = { key: 'u1:1:vt', input: mkv, videoCodec: 'h264', plan, layout, encode: encodeArgs('software') };
      const theirs: HlsSource = { ...mine, key: 'u2:1:vt' };
      await sessions.init(mine);
      await sessions.init(theirs);
      // Still being watched (asked for just now): kept.
      sessions.releaseMovedOn('u1:2:vt');
      expect(sessions.convertingOther('u1:2:vt')).toBe(2);
      // No longer asked for: the same viewer's next title frees it; the other viewer keeps theirs.
      sessions.releaseMovedOn('u1:2:vt', 0);
      expect(sessions.convertingFor('u1:1:vt')).toBe(false);
      expect(sessions.convertingFor('u2:1:vt')).toBe(true);
      expect(sessions.convertingOther('u1:2:vt')).toBe(1);
    } finally {
      sessions.stopAll();
    }
  });

  it('stops FFmpeg far enough ahead where it cannot be paused (Windows), and starts again from the next piece', async () => {
    const film = path.join(dir, 'Rest.mkv');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-c:a', 'ac3', '-y', film]);
    const cache = path.join(dir, 'cache-rest');
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', cache, undefined, { aheadSeconds: () => 12, canPause: false });
    const made = () => fs.readdirSync(cache).flatMap((d) => fs.readdirSync(path.join(cache, d)).filter((f) => /^seg\d+\.m4s$/.test(f)));
    try {
      const layout = await sessions.layout('rest', film, 90, true);
      const src: HlsSource = { key: 'u1:3:vt', input: film, videoCodec: 'h264', plan, layout, encode: encodeArgs('software') };
      const init = await sessions.init(src);
      expect(Math.abs(startOf([init, await sessions.segment(src, 0)]))).toBeLessThan(0.1);
      // FFmpeg stops once it is 12 s ahead: the pieces stop coming, long before the end of the film.
      // Settled = no new piece for 2 s; a slow runner can take longer than one check between pieces.
      let count = made().length;
      for (let i = 0, still = 0; i < 150 && still < 5; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const now = made().length;
        still = now === count ? still + 1 : 0;
        count = now;
      }
      expect(count).toBeGreaterThan(1);
      expect(count).toBeLessThan(layout.starts.length - 5);
      // The player comes closer: a new run picks up at the next piece, with the right times.
      for (let n = 1; n <= count + 4; n++) expect(Math.abs(startOf([init, await sessions.segment(src, n)]) - 4 * n)).toBeLessThan(0.1);
    } finally {
      sessions.stopAll();
    }
  });

  it('cuts converted pieces on the grid when no frame falls exactly on it (23.976 fps)', async () => {
    // At 23.976 fps a run's first frame lies just after its grid point, and the next forced keyframe
    // just under 4 s later. Every piece must still begin where the list says: the player sets its clock
    // (and so the subtitles) by the first piece it loads, which may come from a run that began earlier.
    const film = path.join(dir, 'Film.mkv');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24000/1001', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '240', '-c:a', 'aac', '-ac', '6', '-y', film]);
    const sessions = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-vt-ntsc'));
    try {
      const layout = await sessions.layout('ntsc', film, 60, true);
      const src: HlsSource = { key: 'u1:2:vt', input: film, videoCodec: 'h264', plan, layout, encode: encodeArgs('software') };
      const init = await sessions.init(src);
      for (const n of [0, 1, 2, 3, 6, 7]) expect(Math.abs(startOf([init, await sessions.segment(src, n)]) - 4 * n)).toBeLessThan(0.1);
    } finally {
      sessions.stopAll();
    }
    // A run that starts halfway (resuming, or a jump far ahead), and the pieces after it.
    const resumed = new HlsSessions('ffmpeg', 'ffprobe', path.join(dir, 'cache-vt-ntsc-resume'));
    try {
      const layout = await resumed.layout('ntsc', film, 60, true);
      const src: HlsSource = { key: 'u1:2:vt', input: film, videoCodec: 'h264', plan, layout, encode: encodeArgs('software') };
      const init = await resumed.init(src);
      for (const n of [9, 10, 11]) expect(Math.abs(startOf([init, await resumed.segment(src, n)]) - 4 * n)).toBeLessThan(0.1);
    } finally {
      resumed.stopAll();
    }
  });
});

describe('how far ahead pieces are made', () => {
  it('is set in seconds by an administrator only, within limits, and used for the next request', async () => {
    const env = await createTestEnv();
    try {
      const admin = await setupAdmin(env.app);
      const user = await createUser(env.app, admin, 'viewer');
      const put = (cookie: string, payload: object) => env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie }, payload });
      expect((await env.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie: admin } })).json().aheadSeconds).toBe(120);
      expect((await put(user.cookie, { aheadSeconds: 600 })).statusCode).toBe(403);
      for (const bad of [10, 5000, 90.5, '300']) expect((await put(admin, { aheadSeconds: bad })).statusCode).toBe(400);
      const res = await put(admin, { aheadSeconds: 600 });
      expect(res.statusCode).toBe(200);
      expect(res.json().aheadSeconds).toBe(600);
      expect(env.ctx.settings.get().aheadSeconds).toBe(600);
    } finally {
      await env.cleanup();
    }
  });
});
