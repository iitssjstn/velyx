import type { Prober } from './probe.js';

/**
 * Wraps a prober so no more than `limit` FFprobe processes run at once, across the scanner and
 * on-demand analysis. On a dual-core server one process at a time keeps the machine responsive.
 */
export function limitProber(probe: Prober, limit: number): Prober & { readonly active: number; readonly waiting: number } {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  const run: Prober = async (file) => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await probe(file);
    } finally {
      release();
    }
  };
  return Object.defineProperties(run, {
    active: { get: () => active },
    waiting: { get: () => queue.length },
  }) as Prober & { readonly active: number; readonly waiting: number };
}
