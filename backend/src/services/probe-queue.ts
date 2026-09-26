import type { Prober } from './probe.js';

export type LimitedProber = Prober & {
  /** Runs ahead of queued background work (scans, bulk analysis): someone is waiting to press play. */
  readonly urgent: Prober;
  readonly active: number;
  readonly waiting: number;
};

/**
 * Wraps a prober so no more than `limit` FFprobe processes run at once, across the scanner and
 * on-demand analysis. On a dual-core server one process at a time keeps the machine responsive.
 * Urgent probes (a user starting playback) skip the queue, so a running library scan never makes
 * playback wait for hundreds of files.
 */
export function limitProber(probe: Prober, limit: number): LimitedProber {
  let active = 0;
  const urgentQueue: Array<() => void> = [];
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    (urgentQueue.shift() ?? queue.shift())?.();
  };
  const runWith =
    (target: Array<() => void>): Prober =>
    async (file) => {
      if (active >= limit) await new Promise<void>((resolve) => target.push(resolve));
      active++;
      try {
        return await probe(file);
      } finally {
        release();
      }
    };
  const run = runWith(queue);
  return Object.defineProperties(run, {
    urgent: { value: runWith(urgentQueue) },
    active: { get: () => active },
    waiting: { get: () => queue.length + urgentQueue.length },
  }) as LimitedProber;
}
