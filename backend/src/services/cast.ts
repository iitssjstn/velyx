import crypto from 'node:crypto';

/**
 * Casting (Chromecast and TVs with it built in): the Chromecast fetches the video itself and
 * cannot sign in, so it gets addresses with a short-lived token that opens exactly one file (its
 * stream, subtitles and artwork) for the user who cast it — nothing else, and only for a few
 * hours. The token is signed with the server's secret; nothing is stored.
 */

/** How long a cast token opens its file (a long movie, paused a while, still plays on). */
export const CAST_TOKEN_MS = 8 * 3_600_000;

export interface CastClaims {
  userId: number;
  fileId: number;
  expiresAt: number;
  artwork?: boolean;
}

const b64 = (buf: Buffer) => buf.toString('base64url');

export function signCastToken(secret: string, claims: CastClaims): string {
  const scope = claims.artwork === undefined ? '' : claims.artwork ? '.1' : '.0';
  const body = b64(Buffer.from(`${claims.userId}.${claims.fileId}.${claims.expiresAt}${scope}`));
  const mac = b64(crypto.createHmac('sha256', `cast:${secret}`).update(body).digest());
  return `${body}.${mac}`;
}

/** The claims of a valid, unexpired token; null otherwise. */
export function verifyCastToken(secret: string, token: string | undefined, now = Date.now()): CastClaims | null {
  if (!token || token.length > 200) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = b64(crypto.createHmac('sha256', `cast:${secret}`).update(body).digest());
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const parts = Buffer.from(body, 'base64url').toString().split('.').map(Number);
  if ((parts.length !== 3 && parts.length !== 4) || parts.slice(0, 3).some((n) => !Number.isSafeInteger(n) || n <= 0)) return null;
  const [userId, fileId, expiresAt, artwork] = parts;
  if (artwork !== undefined && artwork !== 0 && artwork !== 1) return null;
  if (expiresAt <= now) return null;
  return { userId, fileId, expiresAt, artwork: artwork === undefined || artwork === 1 };
}

/**
 * What a cast token opens: this file's stream (as it is, or repackaged), its subtitles and the
 * artwork. Returns the file id a path belongs to, 'image' for artwork, or null.
 */
export function castPath(pathname: string): { fileId: number } | { subtitleId: number } | 'image' | null {
  let m = /^\/api\/media\/(\d+)\/(stream|remux|hls\/(?:index\.m3u8|init\.mp4|seg\/\d+\.m4s)|subtitles\/\d+\.vtt)$/.exec(pathname);
  if (m) return { fileId: Number(m[1]) };
  m = /^\/api\/(?:subtitles|online-subtitles)\/(\d+)\.vtt$/.exec(pathname);
  if (m) return { subtitleId: Number(m[1]) };
  if (/^\/api\/images\/[\w-]+\/[\w.-]+$/.test(pathname)) return 'image';
  return null;
}

/**
 * What a Chromecast plays (Google's list for Chromecast with Google TV and TVs with Chromecast
 * built in; older Chromecasts lack HEVC and 10-bit): anything else is repackaged or said so —
 * never transcoded.
 */
export const CHROMECAST_CAPS = {
  containers: ['mp4', 'm4v', 'webm'],
  videoCodecs: ['h264', 'hevc', 'vp8', 'vp9'],
  audioCodecs: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'],
  tenBitCodecs: ['hevc', 'vp9'],
  hdr: false,
  audioTrackSwitching: false,
  imageSubtitles: false,
};
