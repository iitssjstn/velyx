import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HlsSessions, KeyframesStopped, copyLayout, gridLayout, hlsArgs, playlist, readKeyframes, segmentAt, type HlsSource } from '../src/playback/hls.js';
import type { RemuxPlan } from '../src/playback/remux.js';
import { encodeArgs } from '../src/playback/transcode.js';

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
    expect(segmentAt(layout, 0)).toBe(0);
    expect(segmentAt(layout, 16.5)).toBe(5);
    expect(segmentAt(layout, 99)).toBe(9);
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
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('4.000,8.000');
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
});
