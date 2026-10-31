import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import { FRAME_H, FRAME_W, frameStats, type FrameStats } from '../src/services/segments/visual.js';

/** Small deterministic PRNG so synthetic "episodes" are the same on every run. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Music-like audio: notes with harmonics (a chord), plus short noise bursts like percussion, so
 * energy spreads over the whole analysed band as in real soundtracks.
 */
export function melody(seconds: number, seed: number, amp = 5000): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let i = 0;
  while (i < out.length) {
    const len = Math.round((0.15 + r() * 0.45) * SAMPLE_RATE);
    const root = 110 + r() * 330;
    const freqs: number[] = [];
    for (const c of [1, 1.25 + r() * 0.1, 1.5]) for (let h = 1; h <= 6; h++) freqs.push(root * c * h);
    const phase = freqs.map(() => 0);
    const step = freqs.map((f) => (f / SAMPLE_RATE) * TABLE);
    const drum = r() < 0.5;
    for (let k = 0; k < len && i < out.length; k++, i++) {
      const env = Math.min(1, k / 150, (len - k) / 150);
      let v = 0;
      for (let j = 0; j < freqs.length; j++) {
        phase[j] = (phase[j] + step[j]) % TABLE;
        v += SINE[phase[j] | 0] / ((j % 6) + 1);
      }
      if (drum && k < 900) v += (r() - 0.5) * 4 * (1 - k / 900);
      out[i] = (amp / 3) * env * v;
    }
  }
  return out;
}

const TABLE = 4096;
const SINE = Float32Array.from({ length: TABLE }, (_, i) => Math.sin((2 * Math.PI * i) / TABLE));

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

/** Joins parts and adds a little noise (a different encode of the same sound). */
export function episode(parts: Float32Array[], noiseSeed: number, noise = 150): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  const r = rng(noiseSeed);
  let o = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[o + i] = Math.max(-32768, Math.min(32767, Math.round(p[i] + (r() - 0.5) * 2 * noise)));
    o += p.length;
  }
  return out;
}

/** One shot of a synthetic picture (an even light with a slope), different per seed. */
export function shotFrame(seed: number, t: number): FrameStats {
  const f = new Uint8Array(FRAME_W * FRAME_H);
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ (h >>> 16);
  const base = 30 + ((h >>> 0) % 170);
  const dir = (h >>> 8) % 4;
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
    const slope = dir === 0 ? x / 8 : dir === 1 ? -x / 8 : dir === 2 ? y / 4 : -y / 4;
    f[y * FRAME_W + x] = Math.max(0, Math.min(255, Math.round(base + slope)));
  }
  return frameStats(f, t);
}
