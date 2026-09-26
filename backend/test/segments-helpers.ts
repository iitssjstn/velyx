import { SAMPLE_RATE } from '../src/services/segments/fingerprint.js';

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
