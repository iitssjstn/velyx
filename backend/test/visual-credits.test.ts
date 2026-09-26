import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { classify, FRAME_H, FRAME_W, findCredits, frameStats, refineStart, type FrameStats } from '../src/services/segments/visual.js';
import { chapterSegments, parseChapters } from '../src/services/segments/chapters.js';
import { ffmpegFrameReader, ffprobeChapterReader } from '../src/services/segments/readers.js';
import { detectEpisode, type EpisodeAudio } from '../src/services/segments/detect.js';
import { fingerprint } from '../src/services/segments/fingerprint.js';
import { episode, melody } from './segments-helpers.js';

function frame(kind: 'scene' | 'black' | 'credits' | 'night', seed = 1): Uint8Array {
  const f = new Uint8Array(FRAME_W * FRAME_H);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  if (kind === 'scene') for (let i = 0; i < f.length; i++) f[i] = 60 + Math.floor(rnd() * 150);
  if (kind === 'black') f.fill(3);
  if (kind === 'night') {
    f.fill(18);
    for (let i = 0; i < 40; i++) f[Math.floor(rnd() * f.length)] = 230; // a few lamps
  }
  if (kind === 'credits') {
    f.fill(4);
    // Lines of "words": short bright strokes with gaps, a few rows high.
    for (let line = 0; line < 6; line++) {
      const y0 = 20 + line * 25 + (seed % 10);
      for (let y = y0; y < y0 + 4; y++) for (let x = 90; x < 230; x++) if ((x % 7 < 3 && (x >> 4) % 3 !== 2)) f[y * FRAME_W + x] = 220;
    }
  }
  return f;
}

/** Frames every `step` seconds described by [kind, seconds] parts. */
function timeline(parts: [Parameters<typeof frame>[0], number][], step = 2): FrameStats[] {
  const out: FrameStats[] = [];
  let t = 0;
  for (const [kind, sec] of parts) {
    for (let x = 0; x < sec; x += step) out.push(frameStats(frame(kind, out.length + 1), t + x));
    t += sec;
  }
  return out;
}

describe('recognising credits in the picture', () => {
  it('tells text on black from scenes, black and dark night shots', () => {
    expect(classify(frameStats(frame('credits'), 0))).toBe('credits');
    expect(classify(frameStats(frame('scene'), 0))).toBe('scene');
    expect(classify(frameStats(frame('black'), 0))).toBe('black');
    expect(classify(frameStats(frame('night'), 0))).not.toBe('credits');
  });

  it('finds credits running to the end, starting at the text (with a short fade), not in a dark last scene', () => {
    const frames = timeline([['scene', 100], ['night', 30], ['black', 4], ['credits', 60]]);
    expect(findCredits(frames, 194)).toEqual({ start: 130, end: 194, postCredits: null, confidence: 'high' });
  });

  it('keeps a scene after the credits separate, and ignores a few seconds of logos at the end', () => {
    expect(findCredits(timeline([['scene', 100], ['credits', 60], ['scene', 40]]), 200)).toMatchObject({ start: 100, end: 160, postCredits: { start: 160, end: 200 } });
    expect(findCredits(timeline([['scene', 100], ['credits', 60], ['scene', 4]]), 164)).toMatchObject({ start: 100, end: 164, postCredits: null });
  });

  it('tolerates a short interruption inside the credits but not a short text card', () => {
    expect(findCredits(timeline([['scene', 100], ['credits', 30], ['scene', 4], ['credits', 30]]), 164)).toMatchObject({ start: 100, end: 164 });
    expect(findCredits(timeline([['scene', 100], ['credits', 10], ['scene', 80]]), 190)).toBeNull();
  });

  it('refines the start with dense frames', () => {
    const dense = timeline([['scene', 12], ['credits', 10]], 0.5).map((f) => ({ ...f, t: f.t + 88 }));
    expect(refineStart(dense, 104)).toBe(100);
  });
});

describe('chapters', () => {
  it('reads intro, credits and post-credits chapters by name', () => {
    const chapters = parseChapters(JSON.stringify({ chapters: [
      { start_time: '0', end_time: '62.5', tags: { title: 'Previously' } },
      { start_time: '62.5', end_time: '120', tags: { title: 'Opening Credits' } },
      { start_time: '120', end_time: '2500', tags: { title: 'Chapter 3' } },
      { start_time: '2500', end_time: '2580', tags: { title: 'End Credits' } },
      { start_time: '2580', end_time: '2640', tags: { title: 'Post-credits scene' } },
    ] }));
    expect(chapterSegments(chapters, 2640)).toEqual({ intro: { start: 62.5, end: 120 }, credits: { start: 2500, end: 2580 }, postCredits: { start: 2580, end: 2640 } });
    expect(chapterSegments(parseChapters('{"chapters":[{"start_time":"0","end_time":"600","tags":{"title":"Chapter 1"}}]}'), 2640)).toEqual({ intro: null, credits: null, postCredits: null });
    expect(parseChapters('not json')).toEqual([]);
  });
});

describe('choosing between sources', () => {
  const INTRO = melody(30, 5);
  const CREDITS = melody(40, 6);
  const ep = (id: number, cold: number): EpisodeAudio => {
    const pcm = episode([melody(cold, id * 10), INTRO, melody(200, id * 10 + 1), CREDITS], id);
    const d = pcm.length / 5512;
    const tailStart = d - 90;
    return { id, duration: d, head: fingerprint(pcm.subarray(0, 5512 * 100)), tail: fingerprint(pcm.subarray(Math.round(tailStart * 5512))), tailStart };
  };
  const a = ep(1, 20);
  const b = ep(2, 40);

  it('uses chapters first, then the picture, then recurring audio', () => {
    const audio = detectEpisode(a, [b], { intro: [], credits: [] });
    expect(audio.credits?.source).toBe('audio');
    const visual = { start: a.duration - 45, end: a.duration, postCredits: null, confidence: 'high' as const };
    const byPicture = detectEpisode({ ...a, visual }, [b], { intro: [], credits: [] });
    expect(byPicture.credits).toMatchObject({ start: visual.start, source: 'video', confidence: 'high' });
    expect(byPicture.intro?.source).toBe('audio');
    const chapters = { intro: { start: 19, end: 50 }, credits: { start: a.duration - 42, end: a.duration }, postCredits: null };
    const byChapters = detectEpisode({ ...a, visual, chapters }, [b], { intro: [], credits: [] });
    expect(byChapters.intro).toMatchObject({ start: 19, end: 50, source: 'chapters', confidence: 'high' });
    expect(byChapters.credits).toMatchObject({ start: Math.round((a.duration - 42) * 10) / 10, source: 'chapters' });
  }, 30_000);

  it('finds credits in the picture even for a single episode (no audio to compare with)', () => {
    const visual = { start: 200, end: 260, postCredits: { start: 260, end: a.duration }, confidence: 'medium' as const };
    const d = detectEpisode({ ...a, visual }, [], { intro: [], credits: [] });
    expect(d.intro).toBeNull();
    expect(d.credits).toMatchObject({ start: 200, end: 260, source: 'video' });
    expect(d.postCredits).toEqual({ start: 260, end: a.duration });
  });
});

describe('reading real video with FFmpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-video-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('decodes keyframes of the closing minutes, finds the credits and reads chapters', async () => {
    // "Text": rows of short white bars on black, like a page of names in credits.
    const boxes: string[] = [];
    for (let line = 0; line < 14; line++) for (let word = 0; word < 9; word++) boxes.push(`drawbox=x=${120 + word * 45}:y=${30 + line * 22}:w=${20 + (word * 7) % 18}:h=8:color=white:t=fill`);
    const file = path.join(dir, 'ep.mkv');
    const meta = path.join(dir, 'chapters.txt');
    fs.writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=40000\ntitle=Chapter 1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=40000\nEND=66000\ntitle=Credits\n');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=12:d=40',
      '-f', 'lavfi', '-i', `color=black:s=640x360:r=12:d=26,${boxes.join(',')}`,
      '-i', meta,
      '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map_metadata', '2', '-map_chapters', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', '-pix_fmt', 'yuv420p', file,
    ]);
    const frames = await ffmpegFrameReader('ffmpeg')(file, 20, 46, 'keyframes');
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.length).toBeLessThan(40); // keyframes only (every 2 s), not every frame
    const found = findCredits(frames, 66);
    expect(found).toMatchObject({ end: 66, postCredits: null });
    expect(Math.abs(found!.start - 40)).toBeLessThanOrEqual(2);
    const dense = await ffmpegFrameReader('ffmpeg')(file, found!.start - 10, 15, 'dense');
    expect(Math.abs(refineStart(dense, found!.start) - 40)).toBeLessThanOrEqual(0.6);
    expect(chapterSegments(await ffprobeChapterReader('ffprobe')(file), 66).credits).toEqual({ start: 40, end: 66 });
    expect(await ffprobeChapterReader('ffprobe')(path.join(dir, 'missing.mkv'))).toEqual([]);
  }, 60_000);
});
