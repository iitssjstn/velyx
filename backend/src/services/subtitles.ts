import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';

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

/**
 * Extracts an embedded text subtitle stream to WebVTT with FFmpeg (no video/audio decoding),
 * caching the result on disk keyed by file id, stream index and modification time.
 */
export class EmbeddedSubtitleExtractor {
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly ffmpegPath: string,
    private readonly cacheDir: string,
  ) {}

  async extract(fileId: number, mtimeMs: number, mediaPath: string, streamIndex: number): Promise<string> {
    const key = `${fileId}-${streamIndex}-${Math.floor(mtimeMs)}`;
    const target = path.join(this.cacheDir, `${key}.vtt`);
    if (fs.existsSync(target)) return fsp.readFile(target, 'utf8');
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.run(mediaPath, streamIndex, target).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private run(mediaPath: string, streamIndex: number, target: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-nostdin', '-v', 'error', '-i', mediaPath, '-map', `0:${streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'];
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let err = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => (err += c.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          log.warn(`Subtitle extraction failed for stream ${streamIndex} of ${mediaPath}: ${err.trim()}`);
          reject(new Error('Subtitle extraction failed'));
          return;
        }
        const vtt = Buffer.concat(chunks).toString('utf8');
        try {
          await fsp.writeFile(target, vtt);
        } catch (e) {
          log.warn('Could not cache extracted subtitle', e);
        }
        resolve(vtt);
      });
    });
  }
}
