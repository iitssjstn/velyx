import type { FastifyReply, FastifyRequest } from 'fastify';
import type { mediaFiles } from '../db/schema.js';

export type MediaFileRow = typeof mediaFiles.$inferSelect;

/** What the client reports it can decode (from HTMLMediaElement.canPlayType on the frontend). */
export interface ClientCapabilities {
  containers?: string[];
  videoCodecs?: string[];
  audioCodecs?: string[];
}

/** Per-request playback wishes, e.g. an audio track the browser cannot switch to by itself. */
export interface PlaybackOptions {
  /** ffprobe stream index of the wanted audio track. */
  audioIndex?: number;
}

export interface PlaybackDecision {
  engine: string;
  streamUrl: string;
  /** Whether the client is expected to decode the file; 'unknown' when it did not report capabilities. */
  compatible: boolean | 'unknown';
  reasons: string[];
  /**
   * 'range': the stream supports HTTP range requests, the browser seeks by itself.
   * 'restart': the stream is generated live; to seek, the client requests it again with ?start=.
   */
  seek: 'range' | 'restart';
  /** ffprobe stream index of the audio track that will be heard (null = none / browser default). */
  audioIndex: number | null;
  /** Human-readable note shown in the player, e.g. that audio is converted. */
  note: string | null;
  durationSec: number | null;
}

/** The audio track a browser plays by default: the one flagged default, otherwise the first. */
export function defaultAudioIndex(file: MediaFileRow): number | null {
  const tracks = file.audioTracks ?? [];
  return (tracks.find((t) => t.isDefault) ?? tracks[0])?.index ?? null;
}

/**
 * A strategy for delivering media to a client.
 *
 * Engines: DirectPlayEngine (original file, range requests) and RemuxEngine (video copied, audio
 * converted to AAC when needed, streamed as fragmented MP4). A future full TranscodingEngine
 * (FFmpeg with CPU, NVENC, Quick Sync, VAAPI/AMF) plugs into the same registry.
 */
export interface PlaybackEngine {
  readonly id: string;
  decide(file: MediaFileRow, caps: ClientCapabilities, options?: PlaybackOptions): PlaybackDecision | null;
  serve(request: FastifyRequest, reply: FastifyReply, file: MediaFileRow, absolutePath: string): Promise<FastifyReply>;
}

/** Hardware acceleration backends a future transcoder will support. Not hard-coded to any GPU. */
export type HardwareAcceleration = 'none' | 'nvenc' | 'qsv' | 'vaapi' | 'amf' | 'videotoolbox';

export class PlaybackRegistry {
  private engines: PlaybackEngine[] = [];

  register(engine: PlaybackEngine): void {
    this.engines.push(engine);
  }

  get(id: string): PlaybackEngine | undefined {
    return this.engines.find((e) => e.id === id);
  }

  /**
   * The first engine (in registration order) whose decision is expected to play wins. When none
   * is, the first decision is returned so the client can show why the file will not play.
   */
  decide(file: MediaFileRow, caps: ClientCapabilities, options: PlaybackOptions = {}): PlaybackDecision | null {
    let fallback: PlaybackDecision | null = null;
    for (const engine of this.engines) {
      const d = engine.decide(file, caps, options);
      if (!d) continue;
      if (d.compatible !== false) return d;
      fallback ??= d;
    }
    return fallback;
  }
}
