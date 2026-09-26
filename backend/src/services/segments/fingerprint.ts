/**
 * Lightweight audio fingerprints for finding recurring parts of episodes (intros, credits).
 *
 * Audio is decoded by FFmpeg to 5512 Hz mono (a few hundred KB per minute) and cut into short,
 * overlapping frames. Each frame becomes one 32-bit word describing how the energy in 33
 * frequency bands between 300 and 2000 Hz rises or falls, compared with the neighbouring band
 * and the previous frame (the "Philips" robust-hash scheme). The same music gives almost the same
 * words even after different encodes, so two episodes can be compared by counting differing bits.
 * Pure TypeScript, no extra dependencies.
 */

export const SAMPLE_RATE = 5512;
const FRAME = 2048;
const HOP = 512;
/** Seconds per fingerprint frame. */
export const FRAME_SEC = HOP / SAMPLE_RATE;
const BANDS = 33;
const MIN_HZ = 300;
const MAX_HZ = 2000;
/**
 * Frames whose sound between 300 and 2000 Hz is quieter than this (RMS, about -48 dBFS) are
 * treated as silence and never match: dialogue and music are far louder, encoder noise and room
 * tone are not.
 */
const SILENCE_RMS = 32768 * Math.pow(10, -48 / 20);

export interface Fingerprint {
  /** One word per frame; 0 marks silence (never matches). */
  words: Uint32Array;
}

/** FFT bin index ranges for the log-spaced bands. */
function makeBands(FRAME: number): Array<[number, number]> {
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, b / BANDS));
  const hzPerBin = SAMPLE_RATE / FRAME;
  const out: Array<[number, number]> = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = Math.floor(edges[b] / hzPerBin);
    const hi = Math.max(lo + 1, Math.floor(edges[b + 1] / hzPerBin));
    out.push([lo, hi]);
  }
  return out;
}

/** In-place iterative radix-2 FFT (re/im arrays of length FRAME). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function fingerprint(pcm: Int16Array): Fingerprint {
  return fingerprintWith(pcm, FRAME, HOP, true);
}

/** Exposed for tuning; `fingerprint` uses the chosen defaults. */
export function fingerprintWith(pcm: Int16Array, FRAME: number, HOP: number, temporal: boolean): Fingerprint {
  const hann = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const bandBins = makeBands(FRAME);
  let hannEnergy = 0;
  for (let i = 0; i < FRAME; i++) hannEnergy += hann[i] * hann[i];
  // Band energy (sum of |X|²) of a frame whose in-band power is exactly SILENCE_RMS² (Parseval).
  const silenceEnergy = (SILENCE_RMS * SILENCE_RMS * FRAME * hannEnergy) / 2;
  const frames = pcm.length < FRAME ? 0 : Math.floor((pcm.length - FRAME) / HOP) + 1;
  const words = new Uint32Array(frames);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let prev = new Float64Array(BANDS);
  let cur = new Float64Array(BANDS);
  let havePrev = false;
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = pcm[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    for (let b = 0; b < BANDS; b++) {
      const [lo, hi] = bandBins[b];
      let e = 0;
      for (let k = lo; k < hi; k++) e += re[k] * re[k] + im[k] * im[k];
      cur[b] = e;
      total += e;
    }
    const silent = total < silenceEnergy;
    if (silent) words[f] = 0;
    if (!silent && havePrev) {
      let word = 0;
      for (let b = 0; b < 32; b++) {
        const d = temporal ? cur[b] - cur[b + 1] - (prev[b] - prev[b + 1]) : cur[b] - cur[b + 1];
        if (d > 0) word |= 1 << b;
      }
      // 0 is reserved for silence.
      words[f] = word >>> 0 || 1;
    }
    havePrev = !silent;
    [prev, cur] = [cur, prev];
  }
  return { words };
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface CommonSegment {
  /** Frame ranges (end exclusive) in each fingerprint. */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  /** Share of frames in the segment that matched (0–1). */
  ratio: number;
}

export interface MatchOptions {
  /** Shortest segment worth reporting, in frames. */
  minFrames: number;
  /** Longest segment, in frames. */
  maxFrames?: number;
  /**
   * Average differing bits (of 32) over about a second of audio that still counts as the same
   * sound. Unrelated audio averages about 16; the same music in two encodes about 10–12.
   */
  maxMeanBits?: number;
  /** Frames averaged per decision (about one second). */
  window?: number;
  /** Non-matching frames tolerated inside a segment. */
  maxGap?: number;
}

/**
 * The longest stretch of similar audio in two fingerprints, at any relative offset. For every
 * offset the differing bits are averaged over a sliding window of about a second, which tells
 * the same music (a little over 10 of 32 bits differ) from other music (about 16). O(n·m) cheap
 * bit operations: well under a second for ten minutes against ten minutes.
 */
export function longestCommonSegment(a: Fingerprint, b: Fingerprint, opts: MatchOptions): CommonSegment | null {
  const A = a.words;
  const B = b.words;
  const maxMean = opts.maxMeanBits ?? 13;
  const W = opts.window ?? 11;
  const maxGap = opts.maxGap ?? 11;
  const maxFrames = opts.maxFrames ?? Number.POSITIVE_INFINITY;
  const errs = new Uint8Array(Math.max(A.length, B.length));
  let best: CommonSegment | null = null;
  let bestLen = 0;
  for (let d = -(B.length - 1); d < A.length; d++) {
    // Align A[i] with B[i - d].
    const iStart = Math.max(0, d);
    const iEnd = Math.min(A.length, B.length + d);
    const n = iEnd - iStart;
    if (n < opts.minFrames) continue;
    // 255 marks silence on either side: it never matches.
    for (let k = 0; k < n; k++) {
      const x = A[iStart + k];
      const y = B[iStart + k - d];
      errs[k] = x === 0 || y === 0 ? 255 : popcount((x ^ y) >>> 0);
    }
    let runStart = -1;
    let lastMatch = -1;
    let hits = 0;
    const close = () => {
      if (runStart >= 0) {
        const len = lastMatch + 1 - runStart;
        if (len >= opts.minFrames && len <= maxFrames && len > bestLen && hits / len >= 0.6) {
          bestLen = len;
          best = { aStart: iStart + runStart, aEnd: iStart + lastMatch + 1, bStart: iStart + runStart - d, bEnd: iStart + lastMatch + 1 - d, ratio: hits / len };
        }
      }
      runStart = -1;
      hits = 0;
    };
    // Sliding window sum of errors (silence counted as a full miss).
    let sum = 0;
    let silent = 0;
    const half = W >> 1;
    for (let k = 0; k < Math.min(W, n); k++) {
      if (errs[k] === 255) silent++;
      else sum += errs[k];
    }
    for (let k = 0; k < n; k++) {
      // Window centred on k: [k - half, k + half].
      const lo = k - half - 1;
      const hi = k + half;
      if (k > half && hi < n) {
        if (errs[hi] === 255) silent++;
        else sum += errs[hi];
        if (errs[lo] === 255) silent--;
        else sum -= errs[lo];
      }
      const count = Math.min(n, W);
      const hit = errs[k] !== 255 && silent <= count / 3 && sum / Math.max(1, count - silent) <= maxMean;
      if (hit) {
        if (runStart < 0) runStart = k;
        lastMatch = k;
        hits++;
      } else if (runStart >= 0 && k - lastMatch > maxGap) close();
    }
    close();
  }
  return best ? refineEdges(A, B, best) : null;
}

/**
 * The sliding window smears a segment's edges by up to half a second; tighten them to the first
 * and last frames that really match on their own.
 */
function refineEdges(A: Uint32Array, B: Uint32Array, seg: CommonSegment): CommonSegment {
  const d = seg.aStart - seg.bStart;
  const good = (i: number) => {
    const x = A[i];
    const y = B[i - d];
    return x !== 0 && y !== 0 && popcount((x ^ y) >>> 0) <= 11;
  };
  let s = seg.aStart;
  let e = seg.aEnd;
  // Require two good frames in a row so a lucky single frame does not move the edge.
  while (s < e - 2 && !(good(s) && good(s + 1))) s++;
  while (e > s + 2 && !(good(e - 1) && good(e - 2))) e--;
  return { ...seg, aStart: s, aEnd: e, bStart: s - d, bEnd: e - d };
}

/** Share of non-silent frames in a range. */
export function soundRatio(fp: Fingerprint, start: number, end: number): number {
  const s = Math.max(0, start);
  const e = Math.min(fp.words.length, end);
  if (e <= s) return 0;
  let n = 0;
  for (let i = s; i < e; i++) if (fp.words[i] !== 0) n++;
  return n / (e - s);
}
