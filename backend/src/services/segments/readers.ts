import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { FRAME_H, FRAME_W, frameStats, type FrameStats } from './visual.js';
import { parseChapters, type Chapter } from './chapters.js';

/**
 * Small frames from part of a video. `keyframes` decodes only the keyframes (a few percent of the
 * work of full decoding); `dense` decodes everything and keeps two frames per second.
 */
export type FrameReader = (file: string, start: number, duration: number, mode: 'keyframes' | 'dense') => Promise<FrameStats[]>;
export type ChapterReader = (file: string) => Promise<Chapter[]>;

function lowPriority(child: ChildProcess) {
  try {
    if (child.pid) os.setPriority(child.pid, 19);
  } catch {
    /* not allowed here: normal priority */
  }
}

export function ffmpegFrameReader(ffmpegPath: string): FrameReader {
  return (file, start, duration, mode) =>
    new Promise((resolve, reject) => {
      const size = FRAME_W * FRAME_H;
      const filters = `${mode === 'dense' ? 'fps=2,' : ''}scale=${FRAME_W}:${FRAME_H}:flags=fast_bilinear,format=gray,showinfo`;
      const args = [
        '-nostdin', '-hide_banner', '-loglevel', 'info', '-threads', '2',
        ...(mode === 'keyframes' ? ['-skip_frame', 'nokey'] : []),
        '-ss', Math.max(0, start).toFixed(3), '-t', duration.toFixed(3), '-i', file,
        '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filters, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
      ];
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      lowPriority(child);
      const stats: FrameStats[] = [];
      const times: number[] = [];
      let pending: Buffer = Buffer.alloc(0);
      let errTail = '';
      let lineBuf = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
      child.stdout.on('data', (chunk: Buffer) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= size) {
          stats.push(frameStats(new Uint8Array(pending.buffer, pending.byteOffset, size), NaN));
          pending = pending.subarray(size);
        }
      });
      child.stderr.on('data', (c: Buffer) => {
        lineBuf += c.toString();
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';
        for (const l of lines) {
          const m = /Parsed_showinfo.*pts_time:\s*(-?[\d.]+)/.exec(l);
          if (m) times.push(Number(m[1]));
          else if (/error|invalid/i.test(l)) errTail = l.slice(0, 300);
        }
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(errTail || `FFmpeg exited with code ${code}`));
        const n = Math.min(stats.length, times.length);
        // With input seeking, frame times count from the seek point.
        resolve(stats.slice(0, n).map((s, i) => ({ ...s, t: Math.max(0, start + times[i]) })));
      });
    });
}

export function ffprobeChapterReader(ffprobePath: string): ChapterReader {
  return (file) =>
    new Promise((resolve) => {
      const child = spawn(ffprobePath, ['-v', 'error', '-show_chapters', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', (c: Buffer) => {
        if (out.length < 1_000_000) out += c.toString();
      });
      // Chapters are optional: any problem simply means "no chapters".
      child.on('error', () => resolve([]));
      child.on('close', () => {
        clearTimeout(timer);
        resolve(parseChapters(out));
      });
    });
}
