import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../logger.js';
import { LOCAL_ONLY } from '../playback/local-input.js';

const log = createLogger('subtitles');

/** Decodes subtitle bytes: UTF-8 (with/without BOM), UTF-16 BOM, falling back to Windows-1252. */
export function decodeSubtitle(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Converts SubRip text to WebVTT. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const timeIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeIdx === -1) return null;
      const time = lines[timeIdx].replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2').replace(/(\d+:\d{2}:\d{2}\.\d+)\s*-->\s*(\d+:\d{2}:\d{2}\.\d+).*/, '$1 --> $2');
      const text = lines
        .slice(timeIdx + 1)
        .join('\n')
        .replace(/\{\\[^}]*\}/g, '') // strip ASS-style override tags occasionally found in SRT
        .replace(/<font[^>]*>|<\/font>/gi, '');
      return `${time}\n${text}`;
    })
    .filter((b): b is string => b !== null);
  return 'WEBVTT\n\n' + body.join('\n\n') + '\n';
}

export async function readSubtitleAsVtt(file: string, format: 'srt' | 'vtt'): Promise<string> {
  const text = decodeSubtitle(await fsp.readFile(file));
  if (format === 'vtt') return text.startsWith('WEBVTT') ? text : 'WEBVTT\n\n' + text;
  return srtToVtt(text);
}

/** An extraction is stopped after 10 minutes, or for a big file after reading it at 10 MB/s would have taken. */
const MIN_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_BYTES_PER_SEC = 10 * 1024 * 1024;

/** One FFmpeg run: reads the file once and writes every listed subtitle stream. */
interface Run {
  done: Promise<Map<number, string>>;
  /** A viewer waits for one of its subtitles: a background run is then no longer stopped. */
  joined: boolean;
  /** Streams it extracts. */
  count: number;
  stop: () => void;
}

/** `extractAll` was asked to stop (someone started watching). */
export class StoppedError extends Error {
  constructor() {
    super('Subtitle extraction stopped');
  }
}

export const isStopped = (err: unknown): boolean => err instanceof StoppedError;

/**
 * Extracts embedded text subtitle streams to WebVTT with FFmpeg (no video/audio decoding),
 * caching each on disk keyed by file id, stream index and modification time. FFmpeg has to read
 * the whole file for that, so all the file's text subtitles are written in that one read.
 */
export class EmbeddedSubtitleExtractor {
  private inflight = new Map<string, Run>();

  constructor(
    private readonly ffmpegPath: string,
    private readonly cacheDir: string,
  ) {}

  private key(fileId: number, mtimeMs: number, index: number): string {
    return `${fileId}-${index}-${Math.floor(mtimeMs)}`;
  }

  private target(key: string): string {
    return path.join(this.cacheDir, `${key}.vtt`);
  }

  isCached(fileId: number, mtimeMs: number, index: number): boolean {
    return fs.existsSync(this.target(this.key(fileId, mtimeMs, index)));
  }

  /**
   * The WebVTT of one stream, for a viewer. The `also` streams (the file's other text subtitles)
   * are written in the same read, so choosing another language later is instant.
   */
  async extract(fileId: number, mtimeMs: number, mediaPath: string, streamIndex: number, options: { also?: number[]; sizeBytes?: number } = {}): Promise<string> {
    const key = this.key(fileId, mtimeMs, streamIndex);
    const target = this.target(key);
    if (fs.existsSync(target)) return fsp.readFile(target, 'utf8');
    const running = this.inflight.get(key);
    if (running) {
      // Already being read (by another viewer or in the background): wait for that read.
      running.joined = true;
      try {
        return (await running.done).get(streamIndex)!;
      } catch (err) {
        // A stopped background read is read again for this viewer; a failed one only if it held more.
        if (running.count === 1 && !isStopped(err)) throw err;
      }
    } else {
      const also = (options.also ?? []).filter((i) => i !== streamIndex && !this.isCached(fileId, mtimeMs, i) && !this.inflight.has(this.key(fileId, mtimeMs, i)));
      try {
        return (await this.start(fileId, mtimeMs, mediaPath, [streamIndex, ...also], { joined: true, sizeBytes: options.sizeBytes }).done).get(streamIndex)!;
      } catch (err) {
        if (!also.length) throw err;
      }
    }
    // Several subtitles in one go failed (one of them may not convert): just this one.
    return (await this.start(fileId, mtimeMs, mediaPath, [streamIndex], { joined: true, sizeBytes: options.sizeBytes }).done).get(streamIndex)!;
  }

  /**
   * Writes the listed streams that are not cached yet, in one read at the lowest priority
   * (background work). `signal` stops it, unless a viewer is waiting for one of them by then.
   */
  async extractAll(fileId: number, mtimeMs: number, mediaPath: string, indexes: number[], options: { sizeBytes?: number; signal?: AbortSignal } = {}): Promise<void> {
    const todo = indexes.filter((i) => !this.isCached(fileId, mtimeMs, i) && !this.inflight.has(this.key(fileId, mtimeMs, i)));
    if (!todo.length) {
      // Already being read for a viewer: done when that read is.
      const others = new Set(indexes.map((i) => this.inflight.get(this.key(fileId, mtimeMs, i))).filter((r): r is Run => Boolean(r)));
      await Promise.allSettled([...others].map((r) => r.done));
      return;
    }
    if (options.signal?.aborted) throw new StoppedError();
    const run = this.start(fileId, mtimeMs, mediaPath, todo, { joined: false, sizeBytes: options.sizeBytes, background: true });
    const onAbort = () => {
      if (!run.joined) run.stop();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await run.done;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private start(fileId: number, mtimeMs: number, mediaPath: string, indexes: number[], options: { joined: boolean; sizeBytes?: number; background?: boolean }): Run {
    const keys = indexes.map((i) => this.key(fileId, mtimeMs, i));
    // Each output goes to a temporary file first, so a stopped read never leaves a partial subtitle.
    const tmps = keys.map((k) => `${this.target(k)}.${process.pid}.tmp`);
    const args = ['-nostdin', '-v', 'error', ...LOCAL_ONLY, '-i', mediaPath, ...indexes.flatMap((index, n) => ['-map', `0:${index}`, '-c:s', 'webvtt', '-f', 'webvtt', '-y', tmps[n]!])];
    let stopped = false;
    let child: ChildProcess | null = null;
    const run: Run = {
      joined: options.joined,
      count: indexes.length,
      stop: () => {
        stopped = true;
        child?.kill('SIGKILL');
      },
      done: new Promise<Map<number, string>>((resolve, reject) => {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        if (options.background && child.pid) {
          try {
            os.setPriority(child.pid, 19);
          } catch {
            /* best effort */
          }
        }
        let err = '';
        const timeoutMs = Math.max(MIN_TIMEOUT_MS, ((options.sizeBytes ?? 0) / MIN_BYTES_PER_SEC) * 1000);
        const timer = setTimeout(() => child?.kill('SIGKILL'), timeoutMs);
        const clean = () => Promise.all(tmps.map((t) => fsp.rm(t, { force: true })));
        child.stderr!.on('data', (c: Buffer) => {
          if (err.length < 4000) err += c.toString();
        });
        child.on('error', (e) => {
          clearTimeout(timer);
          void clean();
          reject(e);
        });
        child.on('close', async (code) => {
          clearTimeout(timer);
          if (stopped || code !== 0) {
            await clean();
            if (stopped) return reject(new StoppedError());
            log.warn(`Subtitle extraction failed for stream(s) ${indexes.join(', ')} of ${mediaPath}: ${err.trim()}`);
            return reject(new Error('Subtitle extraction failed'));
          }
          const out = new Map<number, string>();
          try {
            for (let n = 0; n < indexes.length; n++) {
              out.set(indexes[n]!, await fsp.readFile(tmps[n]!, 'utf8'));
              await fsp.rename(tmps[n]!, this.target(keys[n]!));
            }
          } catch (e) {
            await clean();
            log.warn('Could not cache extracted subtitle', e);
            return reject(new Error('Subtitle extraction failed'));
          }
          resolve(out);
        });
      }),
    };
    for (const k of keys) this.inflight.set(k, run);
    void run.done
      .catch(() => undefined)
      .finally(() => {
        for (const k of keys) if (this.inflight.get(k) === run) this.inflight.delete(k);
      });
    return run;
  }
}

/**
 * Shifts every cue of a WebVTT document by -offset seconds (used when the player streams a file
 * from a later start position). Cues that end before the new zero point are dropped.
 */
export function shiftVtt(vtt: string, offset: number): string {
  if (!offset) return vtt;
  const toSec = (t: string) => {
    const parts = t.split(':').map(Number);
    return parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
  };
  const fmt = (sec: number) => {
    const ms = Math.round(Math.max(0, sec) * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1) {
      out.push(block);
      continue;
    }
    const m = /^\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const start = toSec(m[1]!) - offset;
    const end = toSec(m[2]!) - offset;
    if (end <= 0) continue;
    lines[i] = `${fmt(start)} --> ${fmt(end)}${m[3] ?? ''}`;
    out.push(lines.join('\n'));
  }
  return out.join('\n\n').replace(/\n*$/, '\n');
}
