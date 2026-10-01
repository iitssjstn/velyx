import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createLogger } from '../../logger.js';
import { detectSeason } from './detect.js';

const log = createLogger('segments');

export type SeasonRunner = (...args: Parameters<typeof detectSeason>) => Promise<ReturnType<typeof detectSeason>>;

/** Detection on the calling thread (development and tests, where no built worker file exists). */
export const inlineSeasonRunner: SeasonRunner = async (...args) => detectSeason(...args);

/**
 * Detection in a worker thread (season-worker.js next to the built server), so the server keeps
 * answering while it calculates. Falls back to the calling thread when the file is not there.
 */
export function workerSeasonRunner(file: URL): SeasonRunner {
  if (!fs.existsSync(file)) return inlineSeasonRunner;
  return (...args) =>
    new Promise<ReturnType<typeof detectSeason>>((resolve, reject) => {
      const worker = new Worker(file);
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
        void worker.terminate();
      };
      worker.once('message', (m: { ok: boolean; result?: ReturnType<typeof detectSeason>; error?: string }) =>
        done(() => (m.ok ? resolve(m.result!) : reject(new Error(m.error)))),
      );
      worker.once('error', (err) => done(() => reject(err)));
      worker.once('exit', (code) => done(() => reject(new Error(`Detection stopped (${code})`))));
      worker.postMessage(args);
    }).catch((err: unknown) => {
      log.warn(`Detection in a separate thread failed (${(err as Error).message}); doing it here instead`);
      return detectSeason(...args);
    });
}
