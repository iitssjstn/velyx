import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Casting (Chromecast and TVs with it built in): the Chromecast fetches the video itself and
 * cannot sign in, so it gets addresses with a short-lived HS256 playback JWT that opens exactly one
 * file (its stream, subtitles and artwork) for the user who cast it — nothing else. The JWT is
 * signed with a key derived from the server's secret; nothing is stored.
 */

/** Long enough for the selected media session, bounded so playback credentials cannot linger. */
export const MAX_PLAYBACK_JWT_MS = 8 * 3_600_000;
const PLAYBACK_JWT_GRACE_MS = 15 * 60_000;
const MIN_PLAYBACK_JWT_MS = 30 * 60_000;

export interface PlaybackJwtClaims {
  userId: number;
  fileId: number;
  expiresAt: number;
  artwork?: boolean;
}

function playbackKey(secret: string): Uint8Array {
  return createHmac('sha256', secret).update('vidalune-playback-jwt-v1').digest();
}

export function playbackJwtExpiresAt(durationSec: number | null, now = Date.now()): number {
  const durationMs = durationSec && Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : 60 * 60_000;
  return now + Math.min(Math.max(durationMs + PLAYBACK_JWT_GRACE_MS, MIN_PLAYBACK_JWT_MS), MAX_PLAYBACK_JWT_MS);
}

export async function signPlaybackJwt(secret: string, claims: PlaybackJwtClaims, now = Date.now()): Promise<string> {
  return new SignJWT({ fileId: claims.fileId, scope: 'media:read', artwork: claims.artwork ?? true })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('vidalune-media')
    .setAudience('vidalune-media')
    .setSubject(String(claims.userId))
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(claims.expiresAt / 1000))
    .sign(playbackKey(secret));
}

/** A valid, unexpired, file-scoped playback JWT; null for any invalid or mismatched token. */
export async function verifyPlaybackJwt(secret: string, token: string | undefined, now = Date.now()): Promise<PlaybackJwtClaims | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, playbackKey(secret), {
      algorithms: ['HS256'],
      issuer: 'vidalune-media',
      audience: 'vidalune-media',
      currentDate: new Date(now),
      clockTolerance: 0,
    });
    const userId = Number(payload.sub);
    const fileId = payload.fileId;
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    if (protectedHeader.typ !== 'JWT' || !Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(fileId) || Number(fileId) <= 0) return null;
    if (payload.scope !== 'media:read' || typeof payload.artwork !== 'boolean') return null;
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt! <= issuedAt! || expiresAt! - issuedAt! > MAX_PLAYBACK_JWT_MS / 1000) return null;
    return { userId, fileId: Number(fileId), expiresAt: Number(expiresAt) * 1000, artwork: payload.artwork };
  } catch {
    return null;
  }
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
