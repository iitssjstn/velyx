import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { classify, FRAME_H, FRAME_W, findCredits, frameDiff, frameStats, pictureEdge, refineStart, type FrameStats } from '../src/services/segments/visual.js';
import { chapterSegments, parseChapters } from '../src/services/segments/chapters.js';
import { ffmpegFrameReader, ffprobeChapterReader } from '../src/services/segments/readers.js';
import { detectEpisode, type EpisodeAudio } from '../src/services/segments/detect.js';
import { fingerprint } from '../src/services/segments/fingerprint.js';
import { episode, melody } from './segments-helpers.js';

/** Lines of "words" (narrow strokes with gaps) in the given grey, a few rows high. */
function writeLines(f: Uint8Array, grey: number, seed: number, lines = 6, x0 = 90, x1 = 230) {
  for (let line = 0; line < lines; line++) {
    const y0 = 20 + line * 25 + (seed % 10);
    for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x1; x++) if ((x % 7 < 3 && (x >> 4) % 3 !== 2)) f[y * FRAME_W + x] = grey;
  }
}

/** A smooth picture (light changing over the frame, like a real shot), shifted a little per seed. */
function smooth(seed: number): Uint8Array {
  const f = new Uint8Array(FRAME_W * FRAME_H);
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) f[y * FRAME_W + x] = Math.round(40 + ((x + seed) % FRAME_W) / 2.5 + y / 3);
  return f;
}

function frame(kind: 'scene' | 'black' | 'credits' | 'night' | 'colour-card' | 'light-card' | 'shot' | 'overlay', seed = 1): Uint8Array {
  if (kind === 'colour-card') {
    const f = new Uint8Array(FRAME_W * FRAME_H).fill(110); // e.g. a red or blue background
    writeLines(f, 245, seed);
    return f;
  }
  if (kind === 'light-card') {
    const f = new Uint8Array(FRAME_W * FRAME_H).fill(235);
    writeLines(f, 15, seed);
    return f;
  }
  if (kind === 'shot') return smooth(seed);
  if (kind === 'overlay') {
    const f = smooth(seed);
    writeLines(f, 250, seed, 4);
    return f;
  }
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

  it('also tells text on a coloured or light background, and text over the picture, from a smooth shot', () => {
    expect(classify(frameStats(frame('colour-card'), 0))).toBe('credits');
    expect(classify(frameStats(frame('light-card'), 0))).toBe('credits');
    expect(classify(frameStats(frame('overlay'), 0))).toBe('overlay');
    expect(classify(frameStats(frame('shot'), 0))).toBe('scene');
    // A busy picture has "strokes" in nearly every row: not text.
    expect(classify(frameStats(frame('scene'), 0))).toBe('scene');
  });

  it('finds credits on a coloured background', () => {
    expect(findCredits(timeline([['shot', 100], ['colour-card', 60]]), 160)).toMatchObject({ start: 100, end: 160, kind: 'card', confidence: 'high' });
    expect(findCredits(timeline([['shot', 100], ['light-card', 60]]), 160)).toMatchObject({ start: 100, end: 160, kind: 'card' });
  });

  it('finds credits over the picture only when they run long enough, never with high confidence, and prefers a card', () => {
    expect(findCredits(timeline([['shot', 100], ['overlay', 50]]), 150)).toMatchObject({ start: 100, end: 150, kind: 'overlay', confidence: 'medium' });
    // A caption of 20 seconds in the last scene is not the credits.
    expect(findCredits(timeline([['shot', 100], ['overlay', 20], ['shot', 40]]), 160)).toBeNull();
    // Text over the picture before a card: the card is the credits.
    expect(findCredits(timeline([['shot', 60], ['overlay', 40], ['shot', 20], ['credits', 40]]), 160)).toMatchObject({ start: 120, kind: 'card' });
  });

  it('compares frames by their coarse picture', () => {
    expect(frameDiff(frameStats(frame('shot', 1), 0), frameStats(frame('shot', 2), 0))).toBeLessThan(2);
    expect(frameDiff(frameStats(frame('shot', 1), 0), frameStats(frame('black'), 0))).toBeGreaterThan(50);
  });

  it('finds credits running to the end, starting at the text (with a short fade), not in a dark last scene', () => {
    const frames = timeline([['scene', 100], ['night', 30], ['black', 4], ['credits', 60]]);
    expect(findCredits(frames, 194)).toEqual({ start: 130, end: 194, postCredits: null, confidence: 'high', kind: 'card' });
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

/** One shot of the picture: an even light with a slope, different per seed. */
function shot(seed: number, t: number): FrameStats {
  const f = new Uint8Array(FRAME_W * FRAME_H);
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ (h >>> 16);
  const base = 30 + ((h >>> 0) % 170);
  const dir = (h >>> 8) % 4;
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
    const slope = dir === 0 ? x / 8 : dir === 1 ? -x / 8 : dir === 2 ? y / 4 : -y / 4;
    f[y * FRAME_W + x] = Math.max(0, Math.min(255, Math.round(base + slope)));
  }
  return frameStats(f, t);
}

/**
 * Dense frames (2 per second, starting at `phase`) of an episode whose intro runs from `start` to
 * `end`: a new shot every second, the same shots in every episode; other scenes differ per episode.
 */
function around(ep: number, start: number, end: number, from: number, to: number, phase = 0, intro = 500): FrameStats[] {
  const out: FrameStats[] = [];
  for (let t = from + phase; t < to; t += 0.5) {
    const seed = t < start ? 100 + ep * 50 + Math.floor(t) : t < end ? intro + Math.floor(t - start) : 3000 + ep * 50 + Math.floor(t);
    out.push(shot(seed, t));
  }
  return out;
}

describe('intro edges in the picture', () => {
  // This episode's intro runs from 40 to 90 s; another episode's from 25 to 75 s. The audio errs the
  // same way in both (the same music), so each reads 6 s either side of where its audio put the edge.
  const edge = (side: 'start' | 'end', audio: number, peerIntro = 500) => {
    const off = audio - (side === 'start' ? 40 : 90);
    const peerAudio = (side === 'start' ? 25 : 75) + off;
    return pictureEdge(around(1, 40, 90, audio - 6, audio + 6), audio, around(2, 25, 75, peerAudio - 6, peerAudio + 6, 0.2, peerIntro), peerAudio, side);
  };

  it('moves the start to where the shared picture begins, also when the audio said otherwise', () => {
    // Music already under the last line of the scene before.
    expect(Math.abs(edge('start', 38)! - 40)).toBeLessThanOrEqual(0.5);
    // A quiet first shot.
    expect(Math.abs(edge('start', 42)! - 40)).toBeLessThanOrEqual(0.5);
  });

  it('moves the end to where the shared picture stops, but never skips more than a few seconds beyond the audio', () => {
    // The music fades before the last title shot.
    expect(Math.abs(edge('end', 88)! - 90)).toBeLessThanOrEqual(0.5);
    // The music runs on into the scene.
    expect(Math.abs(edge('end', 93)! - 90)).toBeLessThanOrEqual(0.5);
    // Capped: the picture would say 90.
    expect(edge('end', 85)).toBe(88);
  });

  it('changes nothing when the other episode shows a different picture', () => {
    expect(edge('start', 40, 1500)).toBeNull();
    expect(edge('end', 90, 1500)).toBeNull();
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
    // "Previously" is the recap.
    expect(chapterSegments(chapters, 2640)).toEqual({ recap: { start: 0, end: 62.5 }, intro: { start: 62.5, end: 120 }, credits: { start: 2500, end: 2580 }, postCredits: { start: 2580, end: 2640 } });
    expect(chapterSegments(parseChapters('{"chapters":[{"start_time":"0","end_time":"600","tags":{"title":"Chapter 1"}}]}'), 2640)).toEqual({ recap: null, intro: null, credits: null, postCredits: null });
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
    const visual = { start: a.duration - 45, end: a.duration, postCredits: null, confidence: 'high' as const, kind: 'card' as const };
    const byPicture = detectEpisode({ ...a, visual }, [b], { intro: [], credits: [] });
    expect(byPicture.credits).toMatchObject({ start: visual.start, source: 'video', confidence: 'high' });
    expect(byPicture.intro?.source).toBe('audio');
    const chapters = { recap: null, intro: { start: 19, end: 50 }, credits: { start: a.duration - 42, end: a.duration }, postCredits: null };
    const byChapters = detectEpisode({ ...a, visual, chapters }, [b], { intro: [], credits: [] });
    expect(byChapters.intro).toMatchObject({ start: 19, end: 50, source: 'chapters', confidence: 'high' });
    expect(byChapters.credits).toMatchObject({ start: Math.round((a.duration - 42) * 10) / 10, source: 'chapters' });
  }, 30_000);

  it('trusts credits over the picture less than credits music recurring in other episodes, and a card more', () => {
    const c = ep(3, 60);
    const audio = detectEpisode(a, [b, c], { intro: [], credits: [] });
    expect(audio.credits).toMatchObject({ source: 'audio', confidence: 'high' });
    const overlay = { start: a.duration - 70, end: a.duration, postCredits: null, confidence: 'medium' as const, kind: 'overlay' as const };
    expect(detectEpisode({ ...a, visual: overlay }, [b, c], { intro: [], credits: [] }).credits).toMatchObject({ source: 'audio', start: audio.credits!.start });
    // Without credits music to compare with, the picture is used.
    expect(detectEpisode({ ...a, visual: overlay }, [], { intro: [], credits: [] }).credits).toMatchObject({ source: 'video', start: overlay.start });
    const card = { ...overlay, confidence: 'high' as const, kind: 'card' as const };
    expect(detectEpisode({ ...a, visual: card }, [b, c], { intro: [], credits: [] }).credits).toMatchObject({ source: 'video', start: card.start });
  }, 30_000);

  it('finds credits in the picture even for a single episode (no audio to compare with)', () => {
    const visual = { start: 200, end: 260, postCredits: { start: 260, end: a.duration }, confidence: 'medium' as const, kind: 'overlay' as const };
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

  it('finds credits over a moving picture, and nothing in the same picture without text', async () => {
    // Lines of narrow letters over a slowly changing gradient, after the same gradient without them.
    const bars: string[] = [];
    for (let line = 0; line < 5; line++) for (let k = 0; k < 24; k++) bars.push(`drawbox=x=${160 + k * 13}:y=${60 + line * 40}:w=4:h=10:color=white:t=fill`);
    const file = path.join(dir, 'overlay.mkv');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'gradients=s=640x360:r=6:d=80:speed=0.02:nb_colors=2:c0=0x202040:c1=0xd0a060:seed=1',
      '-vf', `${bars.map((b) => `${b}:enable='gte(t,40)'`).join(',')}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12', '-pix_fmt', 'yuv420p', file,
    ]);
    const frames = await ffmpegFrameReader('ffmpeg')(file, 0, 80, 'keyframes');
    const found = findCredits(frames, 80);
    expect(found).toMatchObject({ end: 80, kind: 'overlay', confidence: 'medium' });
    expect(Math.abs(found!.start - 40)).toBeLessThanOrEqual(2);
    expect(findCredits(frames.filter((f) => f.t < 39), 39)).toBeNull();
  }, 60_000);
});
