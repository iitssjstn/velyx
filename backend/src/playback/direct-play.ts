import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { videoSupport } from './compatibility.js';
import { defaultAudioIndex, wantsAudioProcessing, type ClientCapabilities, type MediaFileRow, type PlaybackDecision, type PlaybackEngine, type PlaybackOptions } from './engine.js';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range HTTP Range header. Returns null when absent, 'invalid' when unsatisfiable.
 * Multi-range requests are served as the first range (browsers never send them for media).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

const BROWSER_FRIENDLY_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'hevc']);
const BROWSER_FRIENDLY_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3']);

export class DirectPlayEngine implements PlaybackEngine {
  readonly id = 'direct';

  decide(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): PlaybackDecision {
    const reasons: string[] = [];
    const reported = Boolean(caps.videoCodecs?.length || caps.audioCodecs?.length || caps.containers?.length);
    let compatible: boolean | 'unknown' = reported ? true : 'unknown';
    const check = (value: string | null, list: string[] | undefined, label: string) => {
      if (!value || !list) return;
      if (!list.includes(value)) {
        compatible = false;
        reasons.push(`${label} ${value.toUpperCase()} is not supported by this browser`);
      }
    };
    if (reported) {
      check(file.container, caps.containers, 'Container');
      check(file.videoCodec, caps.videoCodecs, 'Video codec');
      check(file.audioCodec, caps.audioCodecs, 'Audio codec');
      const video = videoSupport(file, caps);
      // Codec supported but not at this bit depth (e.g. 10-bit H.264).
      if (video.ok === false && !reasons.some((r) => r.startsWith('Video codec'))) {
        compatible = false;
        reasons.push(video.problem!);
      }
    } else {
      if (file.videoCodec && !BROWSER_FRIENDLY_VIDEO.has(file.videoCodec)) reasons.push(`Video codec ${file.videoCodec.toUpperCase()} may not play in browsers`);
      if (file.audioCodec && !BROWSER_FRIENDLY_AUDIO.has(file.audioCodec)) reasons.push(`Audio codec ${file.audioCodec.toUpperCase()} may not play in browsers`);
    }
    const defaultAudio = defaultAudioIndex(file);
    if (options.audioIndex !== undefined && options.audioIndex !== defaultAudio) {
      // Browsers without the audioTracks API always play the default track.
      compatible = false;
      reasons.push('Another audio track was selected');
    }
    if (wantsAudioProcessing(options)) {
      compatible = false;
      reasons.push('Audio enhancements are enabled');
    }
    return {
      engine: this.id,
      streamUrl: `/api/media/${file.id}/stream`,
      compatible,
      reasons,
      seek: 'range',
      audioIndex: defaultAudio,
      note: null,
      durationSec: file.durationSec,
    };
  }

  async serve(request: FastifyRequest, reply: FastifyReply, file: MediaFileRow, absolutePath: string): Promise<FastifyReply> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch {
      return reply.code(404).send({ error: 'Media file is no longer available. Try rescanning the library.' });
    }
    const size = stat.size;
    const etag = `"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', mimeFor(absolutePath));
    reply.header('ETag', etag);
    reply.header('Last-Modified', stat.mtime.toUTCString());
    reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absolutePath))}`);

    // If-Range: only honour the range when the validator still matches.
    const ifRange = request.headers['if-range'];
    const rangeHeader = ifRange && ifRange !== etag && ifRange !== stat.mtime.toUTCString() ? undefined : request.headers.range;
    const range = parseRange(rangeHeader, size);

    if (range === 'invalid') {
      reply.header('Content-Range', `bytes */${size}`);
      return reply.code(416).send();
    }
    if (request.method === 'HEAD') {
      reply.header('Content-Length', String(range ? range.end - range.start + 1 : size));
      if (range) reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      return reply.code(range ? 206 : 200).send();
    }
    if (!range) {
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      reply.header('Content-Length', String(size));
      return reply.code(200).send(fs.createReadStream(absolutePath, { highWaterMark: 256 * 1024 }));
    }
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    reply.header('Content-Length', String(range.end - range.start + 1));
    return reply.code(206).send(fs.createReadStream(absolutePath, { start: range.start, end: range.end, highWaterMark: 256 * 1024 }));
  }
}
