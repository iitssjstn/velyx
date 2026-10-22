import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../logger.js';
import { audioFilters, type RemuxPlan, type VideoEncode } from './remux.js';

const log = createLogger('hls');

/**
 * HLS: a file the browser cannot open as it is (MKV, or audio it cannot decode) is offered as short
 * pieces of a few seconds and a list of them, the way streaming services deliver video. The player
 * keeps pieces ahead in its buffer and jumps by loading another piece: seeking, skipping an intro
 * and starting where you left off are instant, without a new stream.
 *
 * Pieces are made by FFmpeg while watching, from the position asked for onwards. When the video is
 * only repackaged (copied), every piece runs from one keyframe of the file to the next, found once
 * by reading the file's index (no decoding): a piece is then always the same, wherever FFmpeg starts.
 * When the video is converted, pieces are 4 seconds and FFmpeg puts a keyframe at the start of each.
 */

/** Length of a piece when the video is converted. */
export const GRID_SECONDS = 4;
/** A GOP so long that the encoder makes no keyframes of its own between the forced ones (frames). */
const KEYFRAME_FREE = 100_000;
/** How far ahead of the player pieces are made before FFmpeg rests (seconds of video), unless set otherwise. */
export const AHEAD_SECONDS = 120;
/** Reading a file's keyframes reads the whole file (minutes for a film on a NAS): at most this long. */
const KEYFRAME_SCAN_MS = 20 * 60_000;
/** Stopped and removed after this long without a request. */
const IDLE_MS = 3 * 60_000;
/** A viewer's converted stream not asked for this long, when they start another one: they moved on. */
export const MOVED_ON_MS = 20_000;
/** At most this many being made at once (the oldest stops). */
const MAX_SESSIONS = 8;

/** Where each piece starts (seconds, from 0), and where the last one ends. */
export interface Layout {
  starts: number[];
  duration: number;
}

/** Pieces from keyframe to keyframe (copied video). */
export function copyLayout(keyframes: number[], duration: number): Layout {
  const starts = [...new Set(keyframes.filter((t) => t >= 0 && t < duration).map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  // The first piece starts at 0: a first keyframe just after 0 (an encoder delay) is that piece; one
  // further in has the frames before it as a piece of their own (FFmpeg cuts there too).
  if (starts.length && starts[0]! < 0.5) starts[0] = 0;
  else starts.unshift(0);
  return { starts, duration };
}

/** Pieces of GRID_SECONDS (converted video). */
export function gridLayout(duration: number, step = GRID_SECONDS): Layout {
  const starts: number[] = [];
  for (let t = 0; t < duration; t += step) starts.push(Math.round(t * 1000) / 1000);
  return { starts: starts.length ? starts : [0], duration };
}

/** The list of pieces (VOD playlist). `query` rides along on every address (it carries the audio plan). */
export function playlist(layout: Layout, query: string): string {
  const lengths = layout.starts.map((s, i) => (layout.starts[i + 1] ?? layout.duration) - s);
  const target = Math.max(1, Math.ceil(Math.max(...lengths)));
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS', `#EXT-X-MAP:URI="init.mp4${query}"`];
  lengths.forEach((len, i) => lines.push(`#EXTINF:${Math.max(0.001, len).toFixed(6)},`, `seg/${i}.m4s${query}`));
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

/** Identifies a file's keyframes: a changed file (other size or modification time) is read again. */
export const keyframesKey = (file: { id: number; size: number; mtimeMs: number }): string => `${file.id}:${file.size}:${file.mtimeMs}`;

/**
 * Keyframe times of the first video stream (seconds from the file's start), from the index: no decoding.
 * `background` reads at the lowest priority; `signal` stops the read.
 */
export function readKeyframes(ffprobePath: string, file: string, options: { signal?: AbortSignal; background?: boolean } = {}): Promise<number[]> {
  const run = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(ffprobePath, args, { timeout: KEYFRAME_SCAN_MS, maxBuffer: 256 * 1024 * 1024, signal: options.signal }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
      if (options.background && child.pid) {
        try {
          os.setPriority(child.pid, 19);
        } catch {
          /* best effort */
        }
      }
    });
  return Promise.all([
    run(['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', file]),
    run(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file]),
  ]).then(([start, packets]) => {
    const offset = Number(start.trim()) || 0;
    const out: number[] = [];
    for (const line of packets.split('\n')) {
      const [pts, flags] = line.split(',');
      if (!flags?.includes('K')) continue;
      const t = Number(pts) - offset;
      if (Number.isFinite(t)) out.push(Math.max(0, t));
    }
    return out;
  });
}

/** FFmpeg arguments that make pieces from piece `from` onwards into `dir`. */
export function hlsArgs(input: string, videoCodec: string | null, plan: RemuxPlan, layout: Layout, from: number, dir: string, encode: VideoEncode | null): string[] {
  const start = layout.starts[from] ?? 0;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (encode) args.push(...encode.input);
  if (start > 0) {
    if (encode) args.push('-ss', start.toFixed(3));
    else {
      // Copied video can only start at a keyframe: aim a little past this piece's keyframe, so FFmpeg
      // lands on it (and not on the one before because of rounding).
      const next = layout.starts[from + 1] ?? layout.duration;
      args.push('-noaccurate_seek', '-ss', (start + Math.min(0.5, (next - start) / 2)).toFixed(3));
    }
  }
  // The file's own times (from 0): every piece has the same times, whichever run made it.
  args.push('-copyts', '-start_at_zero', '-fflags', '+genpts', '-i', input, '-map', '0:v:0');
  if (plan.audioIndex !== null) args.push('-map', `0:${plan.audioIndex}`);
  if (encode) {
    // Keyframes only on the grid (the encoder's own every-2-seconds ones are switched off), and a new
    // piece at each of them. Cutting "every 4 s" does not work: FFmpeg counts from the run's first frame,
    // which lies just after its grid point, so the next forced keyframe falls just short and the piece
    // ends at a later keyframe, putting every piece after it seconds away from where the list says.
    // The run's first frame is a keyframe anyway; forcing one on its own grid point as well would make a
    // one-frame piece when that frame lies a hair before the point.
    const forced = layout.starts.slice(from + 1).map((s) => s.toFixed(3)).join(',');
    args.push(...encode.output, '-g', String(KEYFRAME_FREE), ...(forced ? ['-force_key_frames', forced] : []));
    if (encode.output.includes('libx264')) args.push('-sc_threshold', '0');
  } else {
    args.push('-c:v', 'copy');
    if (videoCodec === 'hevc') args.push('-tag:v', 'hvc1');
  }
  if (plan.audioIndex !== null) {
    if (plan.copyAudio) args.push('-c:a', 'copy');
    else {
      const channels = plan.channels ?? 2;
      args.push('-af', audioFilters(plan), '-c:a', 'aac', '-ac', String(channels), '-b:a', channels > 2 ? '384k' : '192k');
    }
  }
  args.push(
    '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-max_muxing_queue_size', '2048',
    '-f', 'hls',
    // A run that starts further in otherwise writes its pieces' times from 0 (and puts the start in its
    // own init, which the player never gets: it keeps the first run's). frag_discont keeps the file's times.
    '-hls_segment_options', 'movflags=+frag_discont',
    // A new piece at every keyframe: copied, the file's own; converted, the ones forced on the grid.
    '-hls_time', '0.01',
    '-hls_segment_type', 'fmp4', '-hls_flags', 'temp_file', '-hls_fmp4_init_filename', 'init.mp4',
    '-start_number', String(from), '-hls_list_size', '0', '-hls_playlist_type', 'event',
    '-hls_segment_filename', path.join(dir, 'seg%d.m4s'),
    path.join(dir, 'index.m3u8'),
  );
  return args;
}

interface Session {
  key: string;
  dir: string;
  child: ChildProcess | null;
  /** First piece of the current run. */
  from: number;
  /** Pieces finished (listed by FFmpeg). */
  done: Set<number>;
  /** Pieces tidy() removed: the run's list still names them, so read() must not mark them done again. */
  tidied: Set<number>;
  /** The run ended (all pieces up to the end made, or it failed). */
  ended: boolean;
  failed: string | null;
  paused: boolean;
  /** FFmpeg was stopped far enough ahead (where it cannot be paused): the run starts again at this piece. */
  restFrom: number | null;
  /** The source of the last request (to start the run again after a rest). */
  src: HlsSource | null;
  lastRequested: number;
  lastUsed: number;
  encode: boolean;
  layout: Layout;
  /** A finished init segment, kept apart from the one a new run rewrites. */
  init: string | null;
}

export interface HlsSource {
  /** Viewer + file + audio plan: one session per combination. */
  key: string;
  input: string;
  videoCodec: string | null;
  plan: RemuxPlan;
  layout: Layout;
  encode: VideoEncode | null;
}

/** Makes and hands out the pieces: one FFmpeg run per session, restarted when the player jumps far. */
/** A background keyframe read was stopped (someone started watching). */
export class KeyframesStopped extends Error {
  constructor() {
    super('Keyframe reading stopped');
  }
}

export interface HlsOptions {
  /** How far ahead of the player pieces are made before FFmpeg rests (seconds of video; read each time). */
  aheadSeconds?: () => number;
  /**
   * Whether FFmpeg can be paused. Windows cannot pause a process: there FFmpeg is stopped once it is far enough
   * ahead, and started again from the next piece when the player comes closer.
   */
  canPause?: boolean;
}

export class HlsSessions {
  private readonly aheadSeconds: () => number;
  private readonly canPause: boolean;
  private readonly sessions = new Map<string, Session>();
  /** Keyframes found (also kept on disk, in `keyframesDir`, across restarts). */
  private readonly known = new Map<string, number[]>();
  /** Keyframes being read: a viewer waiting for one keeps a background read from being stopped. */
  private readonly scans = new Map<string, { done: Promise<number[]>; joined: boolean; stop: () => void }>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string,
    private readonly baseDir: string,
    private readonly keyframesDir: string = `${baseDir}-keyframes`,
    options: HlsOptions = {},
  ) {
    this.aheadSeconds = options.aheadSeconds ?? (() => AHEAD_SECONDS);
    this.canPause = options.canPause ?? process.platform !== 'win32';
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(keyframesDir, { recursive: true });
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref();
  }

  /** The pieces of a file: keyframe to keyframe (copied video, read once) or a fixed grid (converted). */
  async layout(cacheKey: string, input: string, duration: number, converted: boolean): Promise<Layout> {
    if (converted) return gridLayout(duration);
    return copyLayout(await this.keyframes(cacheKey, input), duration);
  }

  /** Whether the keyframes of a file are known, so its list of pieces can be made at once. */
  ready(cacheKey: string): boolean {
    return this.known.has(cacheKey) || fs.existsSync(this.keyframesFile(cacheKey));
  }

  /**
   * Finds a file's keyframes ahead of time (background work, at the lowest priority), so the file can be
   * played in pieces later. `signal` stops it, unless a viewer is waiting for the same keyframes by then.
   */
  async learn(cacheKey: string, input: string, signal?: AbortSignal): Promise<void> {
    if (this.ready(cacheKey)) return;
    const running = this.scans.get(cacheKey);
    if (running) {
      await running.done;
      return;
    }
    if (signal?.aborted) throw new KeyframesStopped();
    const scan = this.scan(cacheKey, input, false);
    const onAbort = () => {
      if (!scan.joined) scan.stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await scan.done;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private keyframesFile(cacheKey: string): string {
    return path.join(this.keyframesDir, `${cacheKey.replace(/[^\w.-]/g, '_')}.json`);
  }

  private keyframes(cacheKey: string, input: string): Promise<number[]> {
    const mem = this.known.get(cacheKey);
    if (mem) return Promise.resolve(mem);
    try {
      const stored = JSON.parse(fs.readFileSync(this.keyframesFile(cacheKey), 'utf8')) as unknown;
      if (Array.isArray(stored) && stored.every((t) => typeof t === 'number')) return Promise.resolve(this.remember(cacheKey, stored as number[]));
    } catch {
      /* not read before */
    }
    const running = this.scans.get(cacheKey);
    if (running) {
      // A viewer waits for a background read: it is no longer stopped, and if it was just stopped, read again.
      running.joined = true;
      return running.done.catch((err: unknown) => (err instanceof KeyframesStopped ? this.scan(cacheKey, input, true).done : Promise.reject(err)));
    }
    return this.scan(cacheKey, input, true).done;
  }

  private scan(cacheKey: string, input: string, joined: boolean) {
    const controller = new AbortController();
    const entry = {
      joined,
      stop: () => controller.abort(),
      done: readKeyframes(this.ffprobePath, input, { signal: controller.signal, background: !joined })
        .then((k) => {
          // Written then renamed: a stopped write never leaves a half list behind.
          const file = this.keyframesFile(cacheKey);
          fs.writeFileSync(`${file}.tmp`, JSON.stringify(k));
          fs.renameSync(`${file}.tmp`, file);
          return this.remember(cacheKey, k);
        })
        .catch((err: unknown) => {
          throw controller.signal.aborted ? new KeyframesStopped() : err;
        }),
    };
    this.scans.set(cacheKey, entry);
    void entry.done.catch(() => undefined).finally(() => {
      if (this.scans.get(cacheKey) === entry) this.scans.delete(cacheKey);
    });
    return entry;
  }

  private remember(cacheKey: string, keyframes: number[]): number[] {
    if (this.known.size > 300) this.known.delete(this.known.keys().next().value!);
    this.known.set(cacheKey, keyframes);
    return keyframes;
  }

  get activeSessions(): number {
    return [...this.sessions.values()].filter((s) => s.child && !s.ended).length;
  }

  /** A converting session for `key` exists: that viewer was let in, its next pieces count as one stream. */
  convertingFor(key: string): boolean {
    return Boolean(this.sessions.get(key)?.encode);
  }

  /**
   * A viewer starts converting another title: their converted streams of other titles that are no
   * longer asked for stop now, instead of holding a place in the conversion limit until they go idle
   * (switching titles while casting would otherwise be refused on a server that converts one at a time).
   */
  releaseMovedOn(key: string, idleMs = MOVED_ON_MS): void {
    const viewer = key.slice(0, key.indexOf(':') + 1);
    if (!viewer) return;
    const now = Date.now();
    for (const s of [...this.sessions.values()]) if (s.encode && s.key !== key && s.key.startsWith(viewer) && now - s.lastUsed >= idleMs) this.drop(s);
  }

  /** Sessions whose video is converted (for the conversion limit), other than `key`. */
  convertingOther(key: string): number {
    // A run stopped while far ahead (Windows) still holds its place: it starts again when the player comes closer.
    return [...this.sessions.values()].filter((s) => s.encode && s.key !== key && ((s.child && !s.ended) || s.restFrom !== null)).length;
  }

  /** The finished init segment of a session (starting it at the first piece when it has not started). */
  async init(src: HlsSource): Promise<string> {
    const s = this.session(src);
    s.lastUsed = Date.now();
    s.src = src;
    // Not started yet, or the last run failed or was stopped before it made one: (re)start it.
    if (!s.child && s.init === null) this.start(s, src, s.lastRequested);
    await this.until(s, () => s.init !== null);
    return s.init!;
  }

  /** The file of piece `n`, made now if it is not there yet. */
  async segment(src: HlsSource, n: number): Promise<string> {
    const s = this.session(src);
    s.lastUsed = Date.now();
    s.lastRequested = n;
    s.src = src;
    const file = path.join(s.dir, `seg${n}.m4s`);
    if (!s.done.has(n)) {
      // Close ahead of the run: wait for it. Behind it or far ahead: start again from here.
      const ahead = Math.max(s.from, ...s.done);
      // A piece behind what the run made is one tidy() removed: this run will not make it again.
      const close = s.child && !s.ended && n >= s.from && n >= ahead && (layoutSeconds(s.layout, ahead, n) < 30 || n <= ahead + 3);
      if (!close) this.start(s, src, n);
    }
    this.resume(s);
    await this.until(s, () => s.done.has(n));
    this.tidy(s);
    return file;
  }

  /** Stops everything (shutdown). */
  stopAll(): void {
    for (const s of this.sessions.values()) this.stop(s);
    clearInterval(this.timer);
  }

  private session(src: HlsSource): Session {
    let s = this.sessions.get(src.key);
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) {
        const oldest = [...this.sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]!;
        this.drop(oldest);
      }
      const dir = fs.mkdtempSync(path.join(this.baseDir, 's-'));
      s = { key: src.key, dir, child: null, from: 0, done: new Set(), tidied: new Set(), ended: false, failed: null, paused: false, restFrom: null, src, lastRequested: 0, lastUsed: Date.now(), encode: !!src.encode, layout: src.layout, init: null };
      this.sessions.set(src.key, s);
    }
    return s;
  }

  private start(s: Session, src: HlsSource, from: number): void {
    this.stop(s);
    // Pieces from here on are made again by this run: until it lists them, they may be half rewritten.
    for (const n of s.done) if (n >= from) s.done.delete(n);
    for (const n of s.tidied) if (n >= from) s.tidied.delete(n);
    // The old run's list would mark those pieces finished again (and make the run look far ahead).
    fs.rmSync(path.join(s.dir, 'index.m3u8'), { force: true });
    s.from = from;
    s.ended = false;
    s.failed = null;
    s.paused = false;
    s.restFrom = null;
    s.src = src;
    const child = spawn(this.ffmpegPath, hlsArgs(src.input, src.videoCodec, src.plan, src.layout, from, s.dir, src.encode), { stdio: ['ignore', 'ignore', 'pipe'] });
    s.child = child;
    let stderr = '';
    child.stderr!.on('data', (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString();
    });
    const poll = setInterval(() => void this.read(s, child), 150);
    child.on('close', (code, signal) => {
      clearInterval(poll);
      if (s.child !== child) return;
      void this.read(s, child).then(() => {
        s.ended = true;
        s.child = null;
        if (code && signal === null) {
          s.failed = stderr.trim().slice(0, 500) || `FFmpeg exited with code ${code}`;
          log.warn(`Could not make HLS pieces of ${src.input}: ${s.failed}`);
        }
      });
    });
    child.on('error', (err) => {
      s.ended = true;
      s.failed = err.message;
      log.error(`Could not start FFmpeg (${this.ffmpegPath}): ${err.message}`);
    });
  }

  /** Reads which pieces FFmpeg finished (it lists a piece once it is complete). */
  private async read(s: Session, child: ChildProcess): Promise<void> {
    if (s.child !== child) return;
    let text: string;
    try {
      text = await fsp.readFile(path.join(s.dir, 'index.m3u8'), 'utf8');
    } catch {
      return;
    }
    for (const m of text.matchAll(/seg(\d+)\.m4s/g)) {
      const n = Number(m[1]);
      if (!s.tidied.has(n)) s.done.add(n);
    }
    if (s.init === null && s.done.size) {
      const kept = path.join(s.dir, 'init-ready.mp4');
      try {
        await fsp.copyFile(path.join(s.dir, 'init.mp4'), kept);
        s.init = kept;
      } catch {
        /* next time */
      }
    }
    // Far enough ahead of the player: FFmpeg rests until the player comes closer. Where it cannot be
    // paused (Windows), it is stopped and started again from the next piece later.
    const made = Math.max(s.from, ...s.done);
    if (s.paused || layoutSeconds(s.layout, s.lastRequested, made) <= this.aheadSeconds() || !child.pid) return;
    if (this.canPause) {
      try {
        process.kill(child.pid, 'SIGSTOP');
        s.paused = true;
      } catch {
        /* gone */
      }
      return;
    }
    // The last piece is close: letting the run finish costs less than starting it again.
    if (made + 1 >= s.layout.starts.length - 1) return;
    this.stop(s);
    s.restFrom = made + 1;
  }

  private resume(s: Session): void {
    const resting = s.restFrom !== null && !s.child;
    if (!resting && (!s.paused || !s.child?.pid)) return;
    const made = Math.max(s.from, ...s.done);
    if (layoutSeconds(s.layout, s.lastRequested, made) > this.aheadSeconds() / 2) return;
    if (resting) {
      if (s.src) this.start(s, s.src, s.restFrom!);
      return;
    }
    try {
      process.kill(s.child!.pid!, 'SIGCONT');
    } catch {
      /* gone */
    }
    s.paused = false;
  }

  private async until(s: Session, ready: () => boolean): Promise<void> {
    const deadline = Date.now() + (s.encode ? 90_000 : 45_000);
    while (!ready()) {
      if (s.ended && !ready()) throw new Error(s.failed ?? 'The piece could not be made.');
      if (Date.now() > deadline) throw new Error('Making the piece took too long.');
      this.resume(s);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Pieces the player is well past are removed (they are made again if it goes back). */
  private tidy(s: Session): void {
    for (const n of s.done) {
      if (n >= s.lastRequested - 8) continue;
      s.done.delete(n);
      s.tidied.add(n);
      fs.rm(path.join(s.dir, `seg${n}.m4s`), { force: true }, () => undefined);
    }
  }

  private stop(s: Session): void {
    const child = s.child;
    s.child = null;
    if (!child) return;
    if (s.paused && child.pid) {
      try {
        process.kill(child.pid, 'SIGCONT');
      } catch {
        /* gone */
      }
    }
    child.kill('SIGKILL');
    s.paused = false;
  }

  private drop(s: Session): void {
    this.stop(s);
    // A request still waiting for this session gets an answer instead of waiting for its deadline.
    s.ended = true;
    s.failed ??= 'The stream was stopped.';
    this.sessions.delete(s.key);
    fs.rm(s.dir, { recursive: true, force: true }, () => undefined);
  }

  private sweep(): void {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) if (now - s.lastUsed > IDLE_MS) this.drop(s);
  }
}

/** Seconds of video from the start of piece `a` to the start of piece `b`. */
function layoutSeconds(layout: Layout, a: number, b: number): number {
  const at = (i: number) => layout.starts[Math.max(0, Math.min(i, layout.starts.length - 1))] ?? 0;
  return at(b) - at(a);
}
