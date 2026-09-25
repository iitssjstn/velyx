import type { FastifyReply, FastifyRequest } from 'fastify';
import type { mediaFiles } from '../db/schema.js';

export type MediaFileRow = typeof mediaFiles.$inferSelect;

/** What the client reports it can decode (from HTMLMediaElement.canPlayType on the frontend). */
export interface ClientCapabilities {
  containers?: string[];
  videoCodecs?: string[];
  audioCodecs?: string[];
}

export interface PlaybackDecision {
  engine: string;
  streamUrl: string;
  /** Whether the client is expected to decode the file; 'unknown' when it did not report capabilities. */
  compatible: boolean | 'unknown';
  reasons: string[];
}

/**
 * A strategy for delivering media to a client.
 *
 * V1 ships DirectPlayEngine only. A future TranscodingEngine (FFmpeg with CPU, NVENC, Quick Sync,
 * VAAPI/AMF) plugs into the same registry: `decide` returns a decision when direct play is not
 * possible and `serve` streams the converted output (e.g. HLS segments).
 */
export interface PlaybackEngine {
  readonly id: string;
  decide(file: MediaFileRow, caps: ClientCapabilities): PlaybackDecision | null;
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

  /** First engine (in registration order) that can handle the file wins. */
  decide(file: MediaFileRow, caps: ClientCapabilities): PlaybackDecision | null {
    for (const engine of this.engines) {
      const d = engine.decide(file, caps);
      if (d) return d;
    }
    return null;
  }
}
