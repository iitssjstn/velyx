import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodeSegments } from '../../db/schema.js';
import { DETECTION_VERSION } from './detect.js';

export interface SegmentSpan {
  start: number;
  end: number;
}

/** A part the player may offer to skip, with how sure the detection was (manual: always high). */
export interface PlayerSpan extends SegmentSpan {
  confidence: 'high' | 'medium';
}

/** What the player uses: only confident (high/medium) or manually set parts. */
export interface PlaybackSegments {
  /** The file the times belong to; another version of the episode may be cut differently. */
  fileId: number | null;
  /** A recap ("previously on") before the intro. */
  recap: PlayerSpan | null;
  intro: PlayerSpan | null;
  credits: PlayerSpan | null;
  /** A scene after the credits: the player never skips it. */
  postCredits: SegmentSpan | null;
  manual: boolean;
}

type Row = typeof episodeSegments.$inferSelect;
type Confidence = Row['introConfidence'];

export function playbackSegments(db: DB, episodeId: number): PlaybackSegments | null {
  const row = db.select().from(episodeSegments).where(eq(episodeSegments.episodeId, episodeId)).get();
  if (!row || row.status !== 'analyzed') return null;
  const span = (start: number | null, end: number | null) => (start !== null && end !== null && end > start ? { start, end } : null);
  const usable = (start: number | null, end: number | null, confidence: Confidence): PlayerSpan | null => {
    const s = span(start, end);
    if (!s) return null;
    if (row.manual || confidence === 'high') return { ...s, confidence: 'high' };
    return confidence === 'medium' ? { ...s, confidence: 'medium' } : null;
  };
  const recap = usable(row.recapStart, row.recapEnd, row.recapConfidence);
  const intro = usable(row.introStart, row.introEnd, row.introConfidence);
  const credits = usable(row.creditsStart, row.creditsEnd, row.creditsConfidence);
  const postCredits = span(row.postCreditsStart, row.postCreditsEnd);
  if (!recap && !intro && !credits && !postCredits) return null;
  return { fileId: row.mediaFileId, recap, intro, credits, postCredits, manual: row.manual };
}

export interface ManualSegments {
  recap?: SegmentSpan | null;
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
    recapStart: s.recap?.start ?? null,
    recapEnd: s.recap?.end ?? null,
    recapConfidence: s.recap ? ('high' as const) : null,
    recapSource: s.recap ? ('manual' as const) : null,
    introStart: s.intro?.start ?? null,
    introEnd: s.intro?.end ?? null,
    introConfidence: s.intro ? ('high' as const) : null,
    creditsStart: s.credits?.start ?? null,
    creditsEnd: s.credits?.end ?? null,
    creditsConfidence: s.credits ? ('high' as const) : null,
    introSource: s.intro ? ('manual' as const) : null,
    creditsSource: s.credits ? ('manual' as const) : null,
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
