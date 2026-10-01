import { parentPort } from 'node:worker_threads';
import { detectSeason } from './services/segments/detect.js';

/**
 * Detects a season's recaps, intros and credits in a thread of its own: comparing fingerprints
 * takes seconds to minutes of steady calculating, and on the server's own thread that would keep
 * it from answering anything else meanwhile (the relay, the app, playback requests).
 */
parentPort!.on('message', (m: Parameters<typeof detectSeason>) => {
  try {
    parentPort!.postMessage({ ok: true, result: detectSeason(...m) });
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: (err as Error).stack ?? String(err) });
  }
});
