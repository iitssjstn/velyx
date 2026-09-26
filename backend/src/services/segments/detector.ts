import os from 'node:os';
import { spawn } from 'node:child_process';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodes, episodeSegments, libraries, mediaFiles, segmentReferences, shows } from '../../db/schema.js';
import { createLogger } from '../../logger.js';
import { fingerprint, longestCommonSegment, SAMPLE_RATE, type Fingerprint } from './fingerprint.js';
import { DETECTION_VERSION, detectSeason, headWindow, tailWindow, type Detection, type EpisodeAudio } from './detect.js';

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
  /** Someone is watching or a scan runs: detection waits (it never competes with either). */
  busy: () => 'playback' | 'scan' | null;
  /** How often a waiting job looks again (default 30 s). */
  retryMs?: number;
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
  counts: { episodes: number; analyzed: number; intros: number; credits: number; pending: number; errors: number; manual: number; lowConfidence: number };
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
        intros: current.filter((r) => r.introStart !== null && usable(r.introConfidence, r.manual)).length,
        credits: current.filter((r) => r.creditsStart !== null && usable(r.creditsConfidence, r.manual)).length,
        pending: this.pending(files).length,
        errors: current.filter((r) => r.status === 'error').length,
        manual: current.filter((r) => r.manual).length,
        lowConfidence: current.filter((r) => !r.manual && (r.introConfidence === 'low' || r.creditsConfidence === 'low')).length,
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

    // Only the episodes to analyse and their nearest neighbours need to be read.
    const indexOf = new Map(files.map((f, i) => [f.episodeId, i]));
    const needed = new Set<number>();
    for (const id of pendingIds) {
      const i = indexOf.get(id)!;
      for (let d = -2; d <= 2; d++) if (files[i + d]) needed.add(i + d);
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
        audio.push(await this.readEpisode(f));
      } catch (err) {
        failed.set(f.episodeId, ((err as Error).message || 'Could not read the audio').slice(0, 500));
      }
      this.running.done++;
    }
    if (this.stopped) return;

    const refs = this.references(job.showId, job.seasonNumber);
    const results = detectSeason(audio, refs, pendingIds);
    const byId = new Map(files.map((f) => [f.episodeId, f]));
    const now = Date.now();
    for (const id of pendingIds) {
      const f = byId.get(id)!;
      const error = failed.get(id);
      const d = results.get(id);
      if (error || !d) this.store(f, null, error ?? 'Not analysed', now);
      else this.store(f, d, null, now);
    }
    this.learnReferences(job, audio, results);
    const found = [...results.values()];
    log.info(`${title} season ${job.seasonNumber}: ${found.filter((d) => d.intro && d.intro.confidence !== 'low').length} intro(s), ${found.filter((d) => d.credits && d.credits.confidence !== 'low').length} credits found`);
  }

  private async readEpisode(f: EpisodeFile): Promise<EpisodeAudio> {
    const head = headWindow(f.duration);
    const tail = tailWindow(f.duration);
    const headPcm = await this.readAudio(f.path, head.start, head.end - head.start);
    if (!(await this.gate())) throw new Error('Stopped');
    const tailPcm = await this.readAudio(f.path, tail.start, tail.end - tail.start);
    if (headPcm.length < SAMPLE_RATE * 5 || tailPcm.length < SAMPLE_RATE * 5) throw new Error('The file has no readable audio');
    return { id: f.episodeId, duration: f.duration, head: fingerprint(headPcm), tail: fingerprint(tailPcm), tailStart: tail.start };
  }

  private store(f: EpisodeFile, d: Detection | null, error: string | null, now: number): void {
    const values = {
      episodeId: f.episodeId,
      mediaFileId: f.fileId,
      fileSize: f.size,
      introStart: d?.intro?.start ?? null,
      introEnd: d?.intro?.end ?? null,
      introConfidence: d?.intro?.confidence ?? null,
      creditsStart: d?.credits?.start ?? null,
      creditsEnd: d?.credits?.end ?? null,
      creditsConfidence: d?.credits?.confidence ?? null,
      postCreditsStart: d?.postCredits?.start ?? null,
      postCreditsEnd: d?.postCredits?.end ?? null,
      status: error ? ('error' as const) : ('analyzed' as const),
      error,
      method: 'audio-fingerprint' as const,
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
    const toFp = (buf: Buffer): Fingerprint => ({ words: new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) });
    return { intro: rows.filter((r) => r.kind === 'intro').map((r) => toFp(r.words)), credits: rows.filter((r) => r.kind === 'credits').map((r) => toFp(r.words)) };
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
        if (!span || span.confidence !== 'high' || !frames || !a) continue;
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

