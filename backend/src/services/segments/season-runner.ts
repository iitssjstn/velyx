import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createLogger } from '../../logger.js';
import { detectSeason } from './detect.js';
import { fingerprint, type Fingerprint } from './fingerprint.js';

const log = createLogger('segments');

export type SeasonRunner = (...args: Parameters<typeof detectSeason>) => Promise<ReturnType<typeof detectSeason>>;
/** Fingerprints of several pieces of audio. */
export type FingerprintRunner = (pcm: Int16Array[]) => Promise<Fingerprint[]>;

/** Detection on the calling thread (development and tests, where no built worker file exists). */
export const inlineSeasonRunner: SeasonRunner = async (...args) => detectSeason(...args);
export const inlineFingerprintRunner: FingerprintRunner = async (pcm) => pcm.map((p) => fingerprint(p));

/** Runs one task in a fresh worker; falls back to `inline` when the worker fails. */
function inWorker<T>(file: URL, message: unknown, inline: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(file);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      void worker.terminate();
    };
    worker.once('message', (m: { ok: boolean; result?: T; error?: string }) => done(() => (m.ok ? resolve(m.result!) : reject(new Error(m.error)))));
    worker.once('error', (err) => done(() => reject(err)));
    worker.once('exit', (code) => done(() => reject(new Error(`Detection stopped (${code})`))));
    worker.postMessage(message);
  }).catch((err: unknown) => {
    log.warn(`Detection in a separate thread failed (${(err as Error).message}); doing it here instead`);
    return inline();
  });
}

/**
 * Detection in a worker thread (season-worker.js next to the built server), so the server keeps
 * answering while it calculates. Falls back to the calling thread when the file is not there.
 */
export function workerSeasonRunner(file: URL): SeasonRunner {
  if (!fs.existsSync(file)) return inlineSeasonRunner;
  return (...args) => inWorker(file, { task: 'season', args }, () => detectSeason(...args));
}

/** Fingerprinting in the worker thread too (seconds for a whole episode). */
export function workerFingerprintRunner(file: URL): FingerprintRunner {
  if (!fs.existsSync(file)) return inlineFingerprintRunner;
  return (pcm) => inWorker(file, { task: 'fingerprint', pcm }, () => pcm.map((p) => fingerprint(p)));
}
