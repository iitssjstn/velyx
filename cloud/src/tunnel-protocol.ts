/**
 * Frames on the tunnel between a Vidalune server and the relay: one WebSocket carries many HTTP
 * requests at once. Every frame is [type: 1 byte][stream: 4 bytes][payload]. The same code lives in
 * backend/src/services/tunnel-protocol.ts (a test checks they match).
 */
export const FRAME = {
  /** relay → server: JSON { method, url, headers, ip, window } */
  request: 1,
  requestBody: 2,
  requestEnd: 3,
  /** server → relay: JSON { status, headers } */
  response: 4,
  responseBody: 5,
  responseEnd: 6,
  /** either way: the stream is cancelled */
  reset: 7,
  /** relay → server: 4-byte count of response bytes the relay can take more of */
  window: 8,
} as const;

export type FrameType = (typeof FRAME)[keyof typeof FRAME];

/** Largest body chunk in one frame. */
export const CHUNK = 64 * 1024;
/** Response bytes a server may send ahead of what the visitor has taken, per stream. */
export const INITIAL_WINDOW = 1024 * 1024;

export function encodeFrame(type: FrameType, stream: number, payload: Buffer | string = Buffer.alloc(0)): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(stream, 1);
  return Buffer.concat([head, body]);
}

export function decodeFrame(data: Buffer): { type: number; stream: number; payload: Buffer } | null {
  if (data.length < 5) return null;
  return { type: data.readUInt8(0), stream: data.readUInt32BE(1), payload: data.subarray(5) };
}

export function windowPayload(bytes: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(bytes, 0);
  return b;
}

/** Headers that belong to one connection and are never passed on. */
export const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'http2-settings']);
