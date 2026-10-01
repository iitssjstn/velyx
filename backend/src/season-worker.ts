import { parentPort } from 'node:worker_threads';
import { detectSeason } from './services/segments/detect.js';
import { fingerprint } from './services/segments/fingerprint.js';

/**
 * Intro, recap and credits detection's heavy calculating, in a thread of its own: fingerprinting
 * audio and comparing a season take seconds to minutes, and on the server's own thread that would
 * keep it from answering anything else meanwhile (the relay, the app, playback requests).
 */
type Task = { task: 'season'; args: Parameters<typeof detectSeason> } | { task: 'fingerprint'; pcm: Int16Array[] };

parentPort!.on('message', (m: Task) => {
  try {
    const result = m.task === 'season' ? detectSeason(...m.args) : m.pcm.map((p) => fingerprint(p));
    parentPort!.postMessage({ ok: true, result });
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: (err as Error).stack ?? String(err) });
  }
});
