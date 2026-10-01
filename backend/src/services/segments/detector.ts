import os from 'node:os';
import { spawn } from 'node:child_process';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodes, episodeSegments, libraries, mediaFiles, segmentFingerprints, segmentReferences, shows } from '../../db/schema.js';
import { createLogger } from '../../logger.js';
import { fingerprint, longestCommonSegment, SAMPLE_RATE, type Fingerprint } from './fingerprint.js';
import { DETECTION_VERSION, detectSeason, RECAP_SOURCES, headWindow, tailWindow, type Detection, type EpisodeAudio } from './detect.js';
import { diagnoseSeason, type SeasonDiagnosis } from './diagnose.js';
import { chapterSegments, type ChapterSegments } from './chapters.js';
import { findCredits, refineStart, type VisualCredits } from './visual.js';
import type { ChapterReader, FrameReader } from './readers.js';
import { sharedFor, sharedReferences, type SharedProfile } from './shared.js';

const log = createLogger('segments');

/** Reads `duration` seconds of the first audio track from `start`, as 5512 Hz mono 16-bit PCM. */
export type AudioReader = (file: string, start: number, duration: number) => Promise<Int16Array>;

/** Decodes audio with FFmpeg at the lowest CPU priority; video is never decoded. */
export function ffmpegAudioReader(ffmpegPath: string): AudioReader {
  return (file, start, duration) =>
    new Promise((resolve, reject) => {
      const args = ['-nostdin', '-v', 'error', '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        if (child.pid) os.setPriority(child.pid, 19);
      } catch {
        /* not allowed on this system: runs at normal priority */
      }
      const chunks: Buffer[] = [];
      let err = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 5 * 60 * 1000);
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => {
        if (err.length < 2000) err += c.toString();
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `FFmpeg exited with code ${code}`));
        const buf = Buffer.concat(chunks);
        const pcm = new Int16Array(buf.length >> 1);
        for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(i * 2);
        resolve(pcm);
      });
    });
}

export interface DetectorHooks {
  /** Detection is switched on in the server settings. */
  enabled: () => boolean;
  /** Also look at the picture for end credits (decodes keyframes of the last minutes). */
  video?: () => boolean;
  /**
   * Detection waits while this says so: a scan runs, or people are watching and the machine is
   * busy. Watching alone does not stop it: it then goes slower (see `pace`).
   */
  busy: () => 'playback' | 'scan' | null;
  /** A pause (ms) after each file read, so playback always comes first (e.g. while someone watches). */
  pace?: () => number;
  /** How often a waiting job looks again (default 30 s). */
  retryMs?: number;
  /** Shared detection (optional): other servers' results for a season, and reporting ours. */
  shared?: {
    profile(showId: number, seasonNumber: number): Promise<SharedProfile | null>;
    report(showId: number, seasonNumber: number): Promise<void>;
  };
}

interface SeasonJob {
  showId: number;
  seasonNumber: number;
  /** Analyse these episodes even when they already have a result (an admin asked). */
  force: Set<number>;
}

export interface DetectorStatus {
  enabled: boolean;
  state: 'idle' | 'running' | 'waiting' | 'disabled';
  waitingFor: 'playback' | 'scan' | null;
  running: { showId: number; showTitle: string; seasonNumber: number; done: number; total: number } | null;
  queuedSeasons: number;
  counts: {
    episodes: number;
    analyzed: number;
    recaps: number;
    intros: number;
    credits: number;
    pending: number;
    errors: number;
    manual: number;
    lowConfidence: number;
    /** Shared detection: episodes with a part taken from other servers, and results others agree with. */
    fromShared: number;
    confirmed: number;
  };
  version: number;
}

interface EpisodeFile {
  episodeId: number;
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  fileId: number;
  path: string;
  size: number;
  duration: number;
}

const MAX_REFERENCES = 3;
/** Format of the stored fingerprints (bump when the fingerprint itself changes). */
const FINGERPRINT_VERSION = 1;

const toWords = (buf: Buffer): Fingerprint => ({ words: new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) });
const toBlob = (fp: Fingerprint) => Buffer.from(fp.words.buffer, fp.words.byteOffset, fp.words.byteLength);

/**
 * Finds intros and credits in the background, one season at a time. It only reads audio (a few
 * minutes at the start and end of each episode), never while someone is watching or a scan runs,
 * and remembers the result so an episode is analysed once — again only when its file changes, the
 * algorithm improves, a low-confidence result can be improved by newly added episodes, or an
 * administrator asks. Manual corrections are never overwritten.
 */
export class SegmentDetector {
  private queue: SeasonJob[] = [];
  private running: DetectorStatus['running'] = null;
  private waitingFor: DetectorStatus['waitingFor'] = null;
  private pumping = false;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];
  private wake: (() => void) | null = null;

  constructor(
    private readonly db: DB,
    private readonly readAudio: AudioReader,
    private readonly hooks: DetectorHooks,
    private readonly readers: { frames?: FrameReader; chapters?: ChapterReader } = {},
  ) {}

  /** Every episode file of a TV library, with the file playback picks first (highest resolution). */
  private episodeFiles(where?: { showId?: number; seasonNumber?: number; episodeIds?: number[] }): EpisodeFile[] {
    const conds = [eq(libraries.type, 'shows')];
    if (where?.showId !== undefined) conds.push(eq(episodes.showId, where.showId));
    if (where?.seasonNumber !== undefined) conds.push(eq(episodes.seasonNumber, where.seasonNumber));
    if (where?.episodeIds) conds.push(inArray(episodes.id, where.episodeIds.length ? where.episodeIds : [-1]));
    const rows = this.db
      .select({
        episodeId: episodes.id,
        showId: episodes.showId,
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        fileId: mediaFiles.id,
        path: mediaFiles.path,
        size: mediaFiles.size,
        duration: mediaFiles.durationSec,
      })
      .from(episodes)
      .innerJoin(mediaFiles, eq(mediaFiles.episodeId, episodes.id))
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .innerJoin(libraries, eq(libraries.id, shows.libraryId))
      .where(and(...conds))
      .orderBy(episodes.showId, episodes.seasonNumber, episodes.episodeNumber, desc(mediaFiles.height), mediaFiles.id)
      .all();
    const seen = new Set<number>();
    const out: EpisodeFile[] = [];
    for (const r of rows) {
      if (seen.has(r.episodeId)) continue;
      seen.add(r.episodeId);
      if (r.duration && r.duration > 60) out.push({ ...r, duration: r.duration });
    }
    return out;
  }

  /** Episodes that can be analysed (a file of more than a minute), optionally of one show. */
  eligible(showId?: number): Set<number> {
    return new Set(this.episodeFiles(showId === undefined ? undefined : { showId }).map((f) => f.episodeId));
  }

  /**
   * Episodes that need (another) analysis: never analysed, a different file or an older algorithm.
   * Weak results are redone when their season gets such new material (more to compare with).
   */
  private pending(files: EpisodeFile[]): EpisodeFile[] {
    if (!files.length) return [];
    const rows = new Map(
      this.db
        .select()
        .from(episodeSegments)
        .where(inArray(episodeSegments.episodeId, files.map((f) => f.episodeId)))
        .all()
        .map((r) => [r.episodeId, r]),
    );
    const season = (f: EpisodeFile) => `${f.showId}:${f.seasonNumber}`;
    const fresh = new Set<number>();
    const newMaterial = new Set<string>();
    for (const f of files) {
      const row = rows.get(f.episodeId);
      if (row?.manual) continue;
      if (!row || row.mediaFileId !== f.fileId || row.fileSize !== f.size || row.version < DETECTION_VERSION) {
        fresh.add(f.episodeId);
        newMaterial.add(season(f));
      }
    }
    return files.filter((f) => {
      if (fresh.has(f.episodeId)) return true;
      const row = rows.get(f.episodeId);
      if (!row || row.manual || row.status === 'error' || !newMaterial.has(season(f))) return false;
      return row.introConfidence !== 'high' || row.creditsConfidence !== 'high';
    });
  }

  /** Queues every season with episodes that still need analysis (after scans and at start-up). */
  enqueuePending(): number {
    if (!this.hooks.enabled()) return 0;
    const seasons = new Set<string>();
    for (const f of this.pending(this.episodeFiles())) {
      const key = `${f.showId}:${f.seasonNumber}`;
      if (seasons.has(key)) continue;
      seasons.add(key);
      this.add({ showId: f.showId, seasonNumber: f.seasonNumber, force: new Set() });
    }
    return seasons.size;
  }

  /**
   * Analyses again on request (manual corrections stay). Returns how many episodes were queued.
   */
  reanalyze(scope: { episodeId: number } | { showId: number; seasonNumber?: number } | 'all'): number {
    const files =
      scope === 'all'
        ? this.episodeFiles()
        : 'episodeId' in scope
          ? this.episodeFiles({ episodeIds: [scope.episodeId] })
          : this.episodeFiles({ showId: scope.showId, seasonNumber: scope.seasonNumber });
    const manual = new Set(
      files.length
        ? this.db
            .select({ id: episodeSegments.episodeId })
            .from(episodeSegments)
            .where(and(inArray(episodeSegments.episodeId, files.map((f) => f.episodeId)), eq(episodeSegments.manual, true)))
            .all()
            .map((r) => r.id)
        : [],
    );
    let count = 0;
    const bySeason = new Map<string, SeasonJob>();
    for (const f of files) {
      if (manual.has(f.episodeId)) continue;
      const key = `${f.showId}:${f.seasonNumber}`;
      if (!bySeason.has(key)) bySeason.set(key, { showId: f.showId, seasonNumber: f.seasonNumber, force: new Set() });
      bySeason.get(key)!.force.add(f.episodeId);
      count++;
    }
    // Stored references of these seasons are rebuilt from the new results.
    for (const job of bySeason.values()) {
      if (scope === 'all' || !('episodeId' in scope)) {
        this.db.delete(segmentReferences).where(and(eq(segmentReferences.showId, job.showId), eq(segmentReferences.seasonNumber, job.seasonNumber))).run();
      }
      this.add(job);
    }
    return count;
  }

  private add(job: SeasonJob): void {
    if (this.stopped) return;
    const same = this.queue.find((j) => j.showId === job.showId && j.seasonNumber === job.seasonNumber);
    if (same) job.force.forEach((id) => same.force.add(id));
    else this.queue.push(job);
    void this.pump();
  }

  status(): DetectorStatus {
    const enabled = this.hooks.enabled();
    const files = this.episodeFiles();
    const rows = files.length ? this.db.select().from(episodeSegments).all() : [];
    const have = new Set(files.map((f) => f.episodeId));
    const current = rows.filter((r) => have.has(r.episodeId));
    const usable = (c: string | null, manual: boolean) => manual || c === 'high' || c === 'medium';
    return {
      enabled,
      state: !enabled ? 'disabled' : this.waitingFor ? 'waiting' : this.running ? 'running' : 'idle',
      waitingFor: this.waitingFor,
      running: this.running ? { ...this.running } : null,
      queuedSeasons: this.queue.length,
      counts: {
        episodes: files.length,
        analyzed: current.filter((r) => r.status === 'analyzed').length,
        recaps: current.filter((r) => r.recapStart !== null && usable(r.recapConfidence, r.manual)).length,
        intros: current.filter((r) => r.introStart !== null && usable(r.introConfidence, r.manual)).length,
        credits: current.filter((r) => r.creditsStart !== null && usable(r.creditsConfidence, r.manual)).length,
        pending: this.pending(files).length,
        errors: current.filter((r) => r.status === 'error').length,
        manual: current.filter((r) => r.manual).length,
        lowConfidence: current.filter((r) => !r.manual && (r.introConfidence === 'low' || r.creditsConfidence === 'low')).length,
        fromShared: current.filter((r) => r.recapSource === 'shared' || r.introSource === 'shared' || r.creditsSource === 'shared').length,
        confirmed: current.filter((r) => r.shareState === 'shared' || r.shareState === 'verified').length,
      },
      version: DETECTION_VERSION,
    };
  }

  /** Resolves when nothing is queued or running (tests). */
  whenIdle(): Promise<void> {
    if (!this.pumping && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Checks right away whether a waiting job can continue (playback or a scan just ended). */
  poke(): void {
    this.wake?.();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.wake?.();
  }

  /** Waits while detection is off, someone watches or a scan runs. False when stopped. */
  private async gate(): Promise<boolean> {
    for (;;) {
      if (this.stopped) return false;
      const busy = this.hooks.enabled() ? this.hooks.busy() : null;
      if (this.hooks.enabled() && !busy) {
        this.waitingFor = null;
        return true;
      }
      this.waitingFor = busy;
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, this.hooks.retryMs ?? 30_000);
        t.unref?.();
        function done() {
          clearTimeout(t);
          resolve();
        }
        this.wake = done;
      });
      this.wake = null;
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.stopped) {
        const job = this.queue.shift()!;
        try {
          await this.runSeason(job);
        } catch (err) {
          log.error(`Intro/credits detection failed for show ${job.showId} season ${job.seasonNumber}`, err);
        }
      }
    } finally {
      this.pumping = false;
      this.running = null;
      this.waitingFor = null;
      this.idleWaiters.splice(0).forEach((w) => w());
    }
  }

  private async runSeason(job: SeasonJob): Promise<void> {
    const files = this.episodeFiles({ showId: job.showId, seasonNumber: job.seasonNumber });
    const pendingIds = new Set(this.pending(files).map((f) => f.episodeId));
    job.force.forEach((id) => {
      if (files.some((f) => f.episodeId === id)) pendingIds.add(id);
    });
    // Manual corrections always win, also over a forced run.
    for (const r of files.length ? this.db.select({ id: episodeSegments.episodeId, manual: episodeSegments.manual }).from(episodeSegments).where(inArray(episodeSegments.episodeId, [...pendingIds].length ? [...pendingIds] : [-1])).all() : []) {
      if (r.manual) pendingIds.delete(r.id);
    }
    if (!pendingIds.size) return;
    const title = this.db.select({ title: shows.title }).from(shows).where(eq(shows.id, job.showId)).get()?.title ?? `Show ${job.showId}`;

    // Only the episodes to analyse and their nearest neighbours need to be read, plus the earlier
    // episodes a recap may quote (read whole).
    const indexOf = new Map(files.map((f, i) => [f.episodeId, i]));
    const needed = new Set<number>();
    const wholeIds = new Set<number>();
    for (const id of pendingIds) {
      const i = indexOf.get(id)!;
      for (let d = -2; d <= 2; d++) if (files[i + d]) needed.add(i + d);
      for (let k = i - 1; k >= 0 && k >= i - RECAP_SOURCES; k--) {
        needed.add(k);
        wholeIds.add(files[k].episodeId);
      }
    }
    // Neighbours further away stand in when a close one is unreadable.
    const order = [...needed].sort((a, b) => a - b);
    this.running = { showId: job.showId, showTitle: title, seasonNumber: job.seasonNumber, done: 0, total: order.length };
    log.info(`Looking for intros and credits: ${title} season ${job.seasonNumber} (${pendingIds.size} episode${pendingIds.size === 1 ? '' : 's'})`);

    const audio: EpisodeAudio[] = [];
    const failed = new Map<number, string>();
    for (const i of order) {
      if (!(await this.gate())) return;
      const f = files[i];
      try {
        audio.push(await this.readEpisode(f, wholeIds.has(f.episodeId)));
      } catch (err) {
        failed.set(f.episodeId, ((err as Error).message || 'Could not read the audio').slice(0, 500));
      }
      this.running.done++;
    }
    if (this.stopped) return;

    // Other servers' fingerprints of this season's intro and credits count as references too.
    const shared = (await this.hooks.shared?.profile(job.showId, job.seasonNumber).catch(() => null)) ?? null;
    const local = this.references(job.showId, job.seasonNumber);
    const extra = sharedReferences(shared);
    const refs = { intro: [...local.intro, ...extra.intro], credits: [...local.credits, ...extra.credits] };
    const known = new Map(
      this.db
        .select()
        .from(episodeSegments)
        .where(inArray(episodeSegments.episodeId, files.map((f) => f.episodeId)))
        .all()
        .map((r) => [
          r.episodeId,
          {
            intro: r.introStart !== null && r.introEnd !== null ? { start: r.introStart, end: r.introEnd, confidence: r.introConfidence ?? 'low', source: 'audio' as const } : null,
            credits: r.creditsStart !== null && r.creditsEnd !== null ? { start: r.creditsStart, end: r.creditsEnd, confidence: r.creditsConfidence ?? 'low', source: 'audio' as const } : null,
            recap: r.recapStart !== null && r.recapEnd !== null ? { start: r.recapStart, end: r.recapEnd, confidence: r.recapConfidence ?? 'low', source: 'audio' as const } : null,
          },
        ]),
    );
    const results = detectSeason(audio, refs, pendingIds, known);
    const byId = new Map(files.map((f) => [f.episodeId, f]));
    const now = Date.now();
    for (const id of pendingIds) {
      const f = byId.get(id)!;
      const error = failed.get(id);
      let d = results.get(id);
      // What was not found here (or not surely) comes from what other servers agree on, when they
      // looked at the same cut of the episode — also for a file whose audio could not be read.
      if (shared) {
        const theirs = sharedFor(shared, f.episodeNumber, f.duration);
        const base: Detection = d ?? { recap: null, intro: null, credits: null, postCredits: null, introFrames: null, creditsFrames: null };
        let used = false;
        for (const kind of ['recap', 'intro', 'credits'] as const) {
          const t = theirs[kind];
          const mine = base[kind];
          if (!t || (mine && mine.confidence !== 'low')) continue;
          base[kind] = { start: t.start, end: t.end, confidence: t.confidence, source: 'shared' };
          used = true;
        }
        if (used) d = base;
      }
      if (!d || (error && !d.recap && !d.intro && !d.credits)) this.store(f, null, error ?? 'Not analysed', now);
      else this.store(f, d, null, now);
    }
    this.learnReferences(job, audio, results);
    // Shared detection: report what was found here (in the background; never holds detection up).
    void this.hooks.shared?.report(job.showId, job.seasonNumber).catch(() => undefined);
    // The whole-episode fingerprints are kept only for the season's last episode (its successor may come later).
    const last = files[files.length - 1]?.episodeId ?? -1;
    this.db
      .update(segmentFingerprints)
      .set({ full: null })
      .where(and(inArray(segmentFingerprints.episodeId, files.map((f) => f.episodeId)), sql`${segmentFingerprints.episodeId} <> ${last}`))
      .run();
    const found = [...results.values()];
    log.info(`${title} season ${job.seasonNumber}: ${found.filter((d) => d.recap && d.recap.confidence !== 'low').length} recap(s), ${found.filter((d) => d.intro && d.intro.confidence !== 'low').length} intro(s), ${found.filter((d) => d.credits && d.credits.confidence !== 'low').length} credits found`);
  }

  /**
   * Analyses one season without storing anything and reports, per episode, what was found with
   * each neighbour and why results were rejected (for the `vidalune intros` command).
   */
  async diagnose(showId: number, seasonNumber: number): Promise<SeasonDiagnosis> {
    const files = this.episodeFiles({ showId, seasonNumber });
    const audio: EpisodeAudio[] = [];
    const errors = new Map<number, string>();
    for (const f of files) {
      try {
        audio.push(await this.readEpisode(f));
      } catch (err) {
        errors.set(f.episodeId, (err as Error).message);
      }
    }
    const tracks = new Map(
      files.length
        ? this.db
            .select({ id: mediaFiles.id, tracks: mediaFiles.audioTracks, codec: mediaFiles.audioCodec, channels: mediaFiles.audioChannels })
            .from(mediaFiles)
            .where(inArray(mediaFiles.id, files.map((f) => f.fileId)))
            .all()
            .map((r) => [r.id, r])
        : [],
    );
    return diagnoseSeason(
      files.map((f) => {
        const t = tracks.get(f.fileId);
        const first = t?.tracks?.[0];
        return { id: f.episodeId, episodeNumber: f.episodeNumber, path: f.path, audio: first ? `${first.codec ?? '?'} ${first.channels ?? '?'}ch ${first.language ?? ''}`.trim() : `${t?.codec ?? '?'} ${t?.channels ?? '?'}ch`, audioTracks: t?.tracks?.length ?? 0, error: errors.get(f.episodeId) ?? null };
      }),
      audio,
    );
  }

  /**
   * An episode's fingerprints and what else was found in its file: from the cache when this same
   * file was read before, otherwise read now (and cached, so an interrupted run continues here).
   * `whole`: also the whole episode (a later episode may quote it in its recap).
   */
  private async readEpisode(f: EpisodeFile, whole = false): Promise<EpisodeAudio> {
    const head = headWindow(f.duration);
    const tail = tailWindow(f.duration);
    const cached = this.db.select().from(segmentFingerprints).where(eq(segmentFingerprints.episodeId, f.episodeId)).get();
    if (cached && cached.mediaFileId === f.fileId && cached.fileSize === f.size && cached.version === FINGERPRINT_VERSION && (!whole || cached.full)) {
      const extras = cached.extras ? (JSON.parse(cached.extras) as { chapters: ChapterSegments | null; visual: VisualCredits | null }) : { chapters: null, visual: null };
      return { id: f.episodeId, duration: f.duration, head: toWords(cached.head), tail: toWords(cached.tail), tailStart: cached.tailStart, chapters: extras.chapters, visual: extras.visual, full: cached.full ? toWords(cached.full) : null };
    }
    let headPcm: Int16Array;
    let tailPcm: Int16Array;
    let full: Fingerprint | null = null;
    if (whole) {
      // One read of the whole audio gives the opening and closing parts too.
      const pcm = await this.readAudio(f.path, 0, f.duration);
      headPcm = pcm.subarray(0, Math.round(head.end * SAMPLE_RATE));
      tailPcm = pcm.subarray(Math.round(tail.start * SAMPLE_RATE), Math.round(tail.end * SAMPLE_RATE));
      full = fingerprint(pcm);
    } else {
      headPcm = await this.readAudio(f.path, head.start, head.end - head.start);
      await this.rest();
      if (!(await this.gate())) throw new Error('Stopped');
      tailPcm = await this.readAudio(f.path, tail.start, tail.end - tail.start);
    }
    await this.rest();
    if (headPcm.length < SAMPLE_RATE * 5 || tailPcm.length < SAMPLE_RATE * 5) throw new Error('The file has no readable audio');
    const chapters = this.readers.chapters ? chapterSegments(await this.readers.chapters(f.path).catch(() => []), f.duration) : null;
    const visual = await this.readVisualCredits(f, tail.start);
    const out: EpisodeAudio = { id: f.episodeId, duration: f.duration, head: fingerprint(headPcm), tail: fingerprint(tailPcm), tailStart: tail.start, chapters, visual, full };
    const row = { episodeId: f.episodeId, mediaFileId: f.fileId, fileSize: f.size, version: FINGERPRINT_VERSION, head: toBlob(out.head), tail: toBlob(out.tail), tailStart: tail.start, full: full ? toBlob(full) : null, extras: JSON.stringify({ chapters, visual }), createdAt: Date.now() };
    this.db.insert(segmentFingerprints).values(row).onConflictDoUpdate({ target: segmentFingerprints.episodeId, set: row }).run();
    return out;
  }

  /** A short pause between reads while someone watches, so their stream always comes first. */
  private async rest(): Promise<void> {
    const ms = this.hooks.pace?.() ?? 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms).unref?.());
  }

  /**
   * Credits in the picture: keyframes of the closing minutes first (cheap), then every half second
   * around the start that was found, to place it precisely. Problems with the video (an unusual
   * codec, no video track) only mean this source is not used.
   */
  private async readVisualCredits(f: EpisodeFile, from: number) {
    if (!this.readers.frames || !(this.hooks.video?.() ?? true)) return null;
    try {
      if (!(await this.gate())) return null;
      const frames = await this.readers.frames(f.path, from, f.duration - from, 'keyframes');
      const found = findCredits(frames, f.duration);
      if (!found) return null;
      if (!(await this.gate())) return found;
      const around = await this.readers.frames(f.path, Math.max(0, found.start - 20), 25, 'dense');
      return { ...found, start: refineStart(around, found.start) };
    } catch (err) {
      log.debug(`Could not analyse the picture of ${f.path}: ${(err as Error).message}`);
      return null;
    }
  }

  private store(f: EpisodeFile, d: Detection | null, error: string | null, now: number): void {
    const values = {
      episodeId: f.episodeId,
      mediaFileId: f.fileId,
      fileSize: f.size,
      recapStart: d?.recap?.start ?? null,
      recapEnd: d?.recap?.end ?? null,
      recapConfidence: d?.recap?.confidence ?? null,
      recapSource: d?.recap?.source ?? null,
      introStart: d?.intro?.start ?? null,
      introEnd: d?.intro?.end ?? null,
      introConfidence: d?.intro?.confidence ?? null,
      creditsStart: d?.credits?.start ?? null,
      creditsEnd: d?.credits?.end ?? null,
      creditsConfidence: d?.credits?.confidence ?? null,
      introSource: d?.intro?.source ?? null,
      creditsSource: d?.credits?.source ?? null,
      postCreditsStart: d?.postCredits?.start ?? null,
      postCreditsEnd: d?.postCredits?.end ?? null,
      status: error ? ('error' as const) : ('analyzed' as const),
      error,
      method: 'automatic' as const,
      version: DETECTION_VERSION,
      manual: false,
      detectedAt: now,
    };
    // A manual correction saved while this job ran is kept.
    this.db.insert(episodeSegments).values(values).onConflictDoUpdate({ target: episodeSegments.episodeId, set: values, setWhere: eq(episodeSegments.manual, false) }).run();
  }

  private references(showId: number, seasonNumber: number) {
    const rows = this.db
      .select()
      .from(segmentReferences)
      .where(and(eq(segmentReferences.showId, showId), eq(segmentReferences.seasonNumber, seasonNumber), eq(segmentReferences.version, DETECTION_VERSION)))
      .all();
    return { intro: rows.filter((r) => r.kind === 'intro').map((r) => toWords(r.words)), credits: rows.filter((r) => r.kind === 'credits').map((r) => toWords(r.words)) };
  }

  /**
   * Keeps the fingerprint of a confidently found intro/credits (a few versions per season), so
   * an episode added later is matched without reading its neighbours again.
   */
  private learnReferences(job: SeasonJob, audio: EpisodeAudio[], results: Map<number, Detection>): void {
    const byId = new Map(audio.map((a) => [a.id, a]));
    for (const kind of ['intro', 'credits'] as const) {
      const existing = this.references(job.showId, job.seasonNumber)[kind];
      for (const [id, d] of results) {
        if (existing.length >= MAX_REFERENCES) break;
        const span = kind === 'intro' ? d.intro : d.credits;
        const frames = kind === 'intro' ? d.introFrames : d.creditsFrames;
        const a = byId.get(id);
        if (!span || span.confidence !== 'high' || span.source !== 'audio' || !frames || !a) continue;
        const words = (kind === 'intro' ? a.head : a.tail).words.slice(frames[0], frames[1]);
        const fp = { words };
        const minFrames = Math.round(words.length * 0.8);
        if (existing.some((r) => longestCommonSegment(fp, r, { minFrames: Math.min(minFrames, Math.round(r.words.length * 0.8)) }))) continue;
        existing.push(fp);
        this.db
          .insert(segmentReferences)
          .values({ showId: job.showId, seasonNumber: job.seasonNumber, kind, words: Buffer.from(words.buffer, words.byteOffset, words.byteLength), version: DETECTION_VERSION })
          .run();
      }
    }
  }
}

