import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodeSegments } from '../../db/schema.js';
import { DETECTION_VERSION } from './detect.js';

export interface SegmentSpan {
  start: number;
  end: number;
}

/** What the player uses: only confident (high/medium) or manually set parts. */
export interface PlaybackSegments {
  /** The file the times belong to; another version of the episode may be cut differently. */
  fileId: number | null;
  intro: SegmentSpan | null;
  credits: SegmentSpan | null;
  /** A scene after the credits: the player never skips it. */
  postCredits: SegmentSpan | null;
  manual: boolean;
}

type Row = typeof episodeSegments.$inferSelect;

const usable = (row: Row, confidence: Row['introConfidence']) => row.manual || confidence === 'high' || confidence === 'medium';

export function playbackSegments(db: DB, episodeId: number): PlaybackSegments | null {
  const row = db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, episodeId)).get();
  if (!row || row.status !== 'analyzed') return null;
  const span = (start: number | null, end: number | null) => (start !== null && end !== null && end > start ? { start, end } : null);
  const intro = usable(row, row.introConfidence) ? span(row.introStart, row.introEnd) : null;
  const credits = usable(row, row.creditsConfidence) ? span(row.creditsStart, row.creditsEnd) : null;
  const postCredits = span(row.postCreditsStart, row.postCreditsEnd);
  if (!intro && !credits && !postCredits) return null;
  return { fileId: row.mediaFileId, intro, credits, postCredits, manual: row.manual };
}

export interface ManualSegments {
  intro: SegmentSpan | null;
  credits: SegmentSpan | null;
  postCredits: SegmentSpan | null;
}

/** Saves an administrator's correction; automatic detection never changes it afterwards. */
export function saveManualSegments(db: DB, episodeId: number, file: { id: number; size: number } | null, s: ManualSegments): void {
  const values = {
    episodeId,
    mediaFileId: file?.id ?? null,
    fileSize: file?.size ?? null,
    introStart: s.intro?.start ?? null,
    introEnd: s.intro?.end ?? null,
    introConfidence: s.intro ? ('high' as const) : null,
    creditsStart: s.credits?.start ?? null,
    creditsEnd: s.credits?.end ?? null,
    creditsConfidence: s.credits ? ('high' as const) : null,
    postCreditsStart: s.postCredits?.start ?? null,
    postCreditsEnd: s.postCredits?.end ?? null,
    status: 'analyzed' as const,
    error: null,
    method: 'manual' as const,
    version: DETECTION_VERSION,
    manual: true,
    detectedAt: Date.now(),
  };
  db.insert(episodeSegments).values(values).onConflictDoUpdate({ target: episodeSegments.episodeId, set: values }).run();
}

/** Drops the stored result (manual or automatic), so the episode is analysed again. */
export function clearSegments(db: DB, episodeId: number): boolean {
  return db.delete(episodeSegments).where(eq(episodeSegments.episodeId, episodeId)).run().changes > 0;
}
