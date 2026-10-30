import { and, eq, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodes, episodeSegments, mediaFiles, segmentReferences, sharedDetectionCache, shows } from '../../db/schema.js';
import { createLogger } from '../../logger.js';
import { DETECTION_VERSION, type Confidence, type References } from './detect.js';
import type { Fingerprint } from './fingerprint.js';

const log = createLogger('segments');

/**
 * Shared detection (always, for a server known to vidalune.com): servers report where they found
 * recaps, intros and credits (by TMDB show, season and episode, with the episode's length, and a few
 * fingerprints of a season's intro and credits) to vidalune.com, which keeps what they agree on.
 * Every server then uses that where its own detection found nothing (or nothing sure), and the
 * fingerprints as extra references. Corrections made in the Control Center on vidalune.com
 * (`overrides`) go before everything: what was found here and a correction by hand here. Nothing
 * about files, users or viewing is sent. When vidalune.com cannot be reached, the last profile
 * kept here is used, or only local detection.
 */

export type SharedKind = 'recap' | 'intro' | 'credits';
export type ShareState = 'pending' | 'shared' | 'verified';

export interface SharedAgreement {
  episode: number;
  kind: SharedKind;
  duration: number;
  start: number;
  end: number;
  confirmations: number;
  reports: number;
  manual: boolean;
}

export interface SharedProfile {
  tmdbShow: number;
  season: number;
  servers: number;
  parts: SharedAgreement[];
  mine: Array<{ episode: number; kind: SharedKind; duration: number; start: number; end: number }>;
  prints: Array<{ kind: 'intro' | 'credits'; words: string }>;
  /** Corrections made in the Control Center: they go before anything found anywhere (missing from an older vidalune.com). */
  overrides?: Array<{ episode: number; kind: SharedKind; duration: number; start: number; end: number }>;
}

/** Lengths within this many seconds are the same cut; timings within this many agree. */
const DURATION_TOLERANCE = 2;
const TIMING_TOLERANCE = 2;
/** How long a profile is used before vidalune.com is asked again. */
export const PROFILE_FRESH_MS = 6 * 3_600_000;
/** How often every season is reported and its profile fetched again (a correction reaches every server within this time). */
export const SHARED_SYNC_MS = 6 * 3_600_000;
/** Shared fingerprints used per kind (each is compared with every episode). */
const SHARED_PRINTS = 3;

const sameCut = (a: { duration: number }, duration: number) => Math.abs(a.duration - duration) <= DURATION_TOLERANCE;

/**
 * The parts other servers agree on for this cut of an episode: two or more servers, or a
 * correction by hand. Three or more (or by hand) is sure enough to skip without a question.
 */
export function sharedFor(profile: SharedProfile, episode: number, duration: number): Partial<Record<SharedKind, { start: number; end: number; confidence: Confidence; confirmations: number }>> {
  const out: Partial<Record<SharedKind, { start: number; end: number; confidence: Confidence; confirmations: number }>> = {};
  for (const a of profile.parts) {
    if (a.episode !== episode || !sameCut(a, duration) || (a.confirmations < 2 && !a.manual) || a.end <= a.start) continue;
    const best = out[a.kind];
    if (best && best.confirmations >= a.confirmations) continue;
    out[a.kind] = { start: a.start, end: a.end, confidence: a.confirmations >= 3 || a.manual ? 'high' : 'medium', confirmations: a.confirmations };
  }
  return out;
}

/** The Control Center's corrections for this cut of an episode (for two of nearly the same length, the closest). */
export function overridesFor(profile: SharedProfile, episode: number, duration: number): Partial<Record<SharedKind, { start: number; end: number }>> {
  const out: Partial<Record<SharedKind, { start: number; end: number }>> = {};
  const off: Partial<Record<SharedKind, number>> = {};
  for (const o of profile.overrides ?? []) {
    if (o.episode !== episode || !sameCut(o, duration) || o.end <= o.start) continue;
    const d = Math.abs(o.duration - duration);
    if ((off[o.kind] ?? Infinity) <= d) continue;
    off[o.kind] = d;
    out[o.kind] = { start: o.start, end: o.end };
  }
  return out;
}

/** How far other servers back up a part found here. */
export function shareState(profile: SharedProfile, episode: number, duration: number, kind: SharedKind, start: number, end: number): ShareState {
  const a = profile.parts.find((p) => p.episode === episode && p.kind === kind && sameCut(p, duration) && Math.abs(p.start - start) <= TIMING_TOLERANCE && Math.abs(p.end - end) <= TIMING_TOLERANCE);
  const n = a?.confirmations ?? 0;
  return n >= 3 ? 'verified' : n === 2 ? 'shared' : 'pending';
}

const ORDER: ShareState[] = ['pending', 'shared', 'verified'];
/** An episode is as far as its least backed-up part. */
export function weakest(states: ShareState[]): ShareState | null {
  if (!states.length) return null;
  return states.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a));
}

/** Other servers' fingerprints, as extra references for the detection. */
export function sharedReferences(profile: SharedProfile | null): References {
  const refs: References = { intro: [], credits: [] };
  if (!profile) return refs;
  for (const p of profile.prints) {
    if (refs[p.kind].length >= SHARED_PRINTS) continue;
    const buf = Buffer.from(p.words, 'base64');
    if (buf.length < 80 || buf.length % 4) continue;
    const fp: Fingerprint = { words: new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) };
    refs[p.kind].push(fp);
  }
  return refs;
}

interface CloudCalls {
  registered(): boolean;
  detectionProfile<T>(tmdbShow: number, season: number): Promise<T>;
  reportDetection<T>(body: unknown): Promise<T>;
}

type Row = typeof episodeSegments.$inferSelect;

export class SharedDetection {
  constructor(
    private readonly db: DB,
    private readonly cloud: CloudCalls,
    /** Whether this server sends its own results (on by default). Off: it only receives. */
    private readonly share: () => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * On for a server known to vidalune.com; a server that is not stays local (it is never
   * registered for this). Sending can be switched off; receiving goes on.
   */
  private on(): boolean {
    return this.cloud.registered();
  }

  private tmdbOf(showId: number): number | null {
    return this.db.select({ tmdb: shows.tmdbId }).from(shows).where(eq(shows.id, showId)).get()?.tmdb ?? null;
  }

  private cached(tmdbShow: number, season: number) {
    return this.db.select().from(sharedDetectionCache).where(and(eq(sharedDetectionCache.tmdbShow, tmdbShow), eq(sharedDetectionCache.season, season))).get();
  }

  private keep(profile: SharedProfile): SharedProfile {
    const row = { tmdbShow: profile.tmdbShow, season: profile.season, profile: JSON.stringify(profile), fetchedAt: this.now() };
    this.db.insert(sharedDetectionCache).values(row).onConflictDoUpdate({ target: [sharedDetectionCache.tmdbShow, sharedDetectionCache.season], set: row }).run();
    return profile;
  }

  /** A season's profile: kept for a while; asked again after that; the last one when unreachable. */
  async profile(showId: number, season: number): Promise<SharedProfile | null> {
    if (!this.on()) return null;
    const tmdb = this.tmdbOf(showId);
    if (!tmdb) return null;
    const cached = this.cached(tmdb, season);
    if (cached && this.now() - cached.fetchedAt < PROFILE_FRESH_MS) return JSON.parse(cached.profile) as SharedProfile;
    try {
      return this.keep(await this.cloud.detectionProfile<SharedProfile>(tmdb, season));
    } catch (err) {
      log.debug(`Shared detection not available: ${(err as Error).message}`);
      return cached ? (JSON.parse(cached.profile) as SharedProfile) : null;
    }
  }

  /** The season's episodes as analysed here: number, length of the analysed file, stored result. */
  private season(showId: number, season: number) {
    return this.db
      .select({ number: episodes.episodeNumber, duration: mediaFiles.durationSec, seg: episodeSegments })
      .from(episodeSegments)
      .innerJoin(episodes, eq(episodes.id, episodeSegments.episodeId))
      .leftJoin(mediaFiles, eq(mediaFiles.id, episodeSegments.mediaFileId))
      .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, season)))
      .all()
      .filter((r): r is { number: number; duration: number; seg: Row } => r.duration !== null && r.duration > 60);
  }

  /**
   * Reports what this server found in a season (its own results only, never what it took from
   * others), keeps the answer, labels the results and fills gaps with what others agree on.
   * Never throws: without vidalune.com, detection simply stays local.
   */
  async report(showId: number, season: number): Promise<void> {
    if (!this.on()) return;
    const tmdb = this.tmdbOf(showId);
    if (!tmdb) return;
    const rows = this.season(showId, season);
    if (!this.share()) {
      // Not sharing: nothing is sent, but the season's profile (corrections and what others agree
      // on) is still asked for and used.
      let received: SharedProfile;
      try {
        received = this.keep(await this.cloud.detectionProfile<SharedProfile>(tmdb, season));
      } catch (err) {
        log.debug(`Shared detection not available: ${(err as Error).message}`);
        return;
      }
      this.apply(rows, received);
      return;
    }
    const own = (r: Row) => {
      const parts: Array<{ kind: SharedKind; start: number; end: number; source: 'audio' | 'chapters' | 'video' | 'manual' }> = [];
      const add = (kind: SharedKind, start: number | null, end: number | null, confidence: Row['introConfidence'], source: Row['introSource']) => {
        if (start === null || end === null || end <= start || source === 'shared' || source === 'central') return;
        if (!r.manual && confidence !== 'high' && confidence !== 'medium') return;
        parts.push({ kind, start, end, source: r.manual || source === 'manual' ? 'manual' : source === 'chapters' || source === 'video' ? source : 'audio' });
      };
      add('recap', r.recapStart, r.recapEnd, r.recapConfidence, r.recapSource);
      add('intro', r.introStart, r.introEnd, r.introConfidence, r.introSource);
      add('credits', r.creditsStart, r.creditsEnd, r.creditsConfidence, r.creditsSource);
      return parts;
    };
    const refs = this.db
      .select()
      .from(segmentReferences)
      .where(and(eq(segmentReferences.showId, showId), eq(segmentReferences.seasonNumber, season), eq(segmentReferences.version, DETECTION_VERSION)))
      .all();
    const body = {
      tmdbShow: tmdb,
      season,
      episodes: rows.filter((r) => r.seg.status === 'analyzed').map((r) => ({ episode: r.number, duration: Math.round(r.duration * 10) / 10, parts: own(r.seg) })),
      prints: refs.slice(0, 6).map((r) => ({ kind: r.kind, words: r.words.toString('base64') })),
    };
    let profile: SharedProfile;
    try {
      profile = this.keep(await this.cloud.reportDetection<SharedProfile>(body));
    } catch (err) {
      log.debug(`Could not share detection results: ${(err as Error).message}`);
      return;
    }
    this.apply(rows, profile);
  }

  /**
   * Labels every result of the season, puts in the Control Center's corrections, and fills what was
   * not found here with what others agree on.
   *
   * A correction from the Control Center replaces that part, also a correction by hand here; the
   * other parts of a corrected episode stay as they are (an episode corrected by hand here stays
   * `manual`, so the rest of its correction still holds and is not analysed over). The part gets the
   * source `central`, so the admin page shows it was set on vidalune.com and it is never reported
   * back as found here. A part taken from vidalune.com (source `shared` or `central`) that nothing
   * backs any more — the correction was removed, or the servers no longer agree — is emptied and its
   * episode analysed again by the usual rules.
   */
  private apply(rows: Array<{ number: number; duration: number; seg: Row }>, profile: SharedProfile): void {
    for (const { number, duration, seg } of rows) {
      const set: Partial<Row> = {};
      const forced = overridesFor(profile, number, duration);
      const theirs = sharedFor(profile, number, duration);
      let stale = false;
      for (const kind of ['recap', 'intro', 'credits'] as const) {
        const o = forced[kind];
        const source = seg[`${kind}Source`];
        if (o) {
          Object.assign(set, { [`${kind}Start`]: o.start, [`${kind}End`]: o.end, [`${kind}Confidence`]: 'high', [`${kind}Source`]: 'central' });
          continue;
        }
        const start = seg[`${kind}Start`];
        const weak = start === null || seg[`${kind}Confidence`] === 'low' || seg[`${kind}Confidence`] === null;
        const t = seg.manual ? undefined : theirs[kind];
        const borrowed = source === 'shared' || source === 'central';
        // Also updates an earlier shared part when more servers agree now.
        if (t && (weak || borrowed)) {
          Object.assign(set, { [`${kind}Start`]: t.start, [`${kind}End`]: t.end, [`${kind}Confidence`]: t.confidence, [`${kind}Source`]: 'shared' });
        } else if (borrowed && start !== null) {
          Object.assign(set, { [`${kind}Start`]: null, [`${kind}End`]: null, [`${kind}Confidence`]: null, [`${kind}Source`]: null });
          stale = true;
        }
      }
      // Analysed again (by the detector, after a scan or at start-up) for what was emptied.
      if (stale && !seg.manual) set.version = 0;
      if (seg.status === 'error' && Object.keys(set).some((k) => k.endsWith('Start') && set[k as keyof Row] !== null)) Object.assign(set, { status: 'analyzed', error: null });
      const now = { ...seg, ...set } as Row;
      const states: ShareState[] = [];
      for (const kind of ['recap', 'intro', 'credits'] as const) {
        const start = now[`${kind}Start`];
        const end = now[`${kind}End`];
        if (start === null || end === null) continue;
        if (!now.manual && now[`${kind}Confidence`] !== 'high' && now[`${kind}Confidence`] !== 'medium') continue;
        states.push(shareState(profile, number, duration, kind, start, end));
      }
      set.shareState = weakest(states);
      this.db.update(episodeSegments).set(set).where(eq(episodeSegments.episodeId, seg.episodeId)).run();
    }
  }

  /** Every season with results here (after turning it on, and now and then): report and fill gaps. */
  async syncAll(pause = 500): Promise<number> {
    if (!this.on()) return 0;
    const seasons = this.db
      .selectDistinct({ showId: episodes.showId, season: episodes.seasonNumber })
      .from(episodeSegments)
      .innerJoin(episodes, eq(episodes.id, episodeSegments.episodeId))
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(isNotNull(shows.tmdbId))
      .all();
    let n = 0;
    for (const s of seasons) {
      if (!this.on()) break;
      await this.report(s.showId, s.season);
      n++;
      if (pause) await new Promise((r) => setTimeout(r, pause).unref?.());
    }
    return n;
  }
}
