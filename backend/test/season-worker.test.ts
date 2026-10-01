import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint, SAMPLE_RATE } from '../src/services/segments/fingerprint.js';
import { detectSeason, headWindow, tailWindow, type EpisodeAudio } from '../src/services/segments/detect.js';
import { inlineFingerprintRunner, inlineSeasonRunner, workerFingerprintRunner, workerSeasonRunner } from '../src/services/segments/season-runner.js';
import { episode, melody } from './segments-helpers.js';

const INTRO = melody(35, 1001);
const CREDITS = melody(45, 3003);

function makeEpisode(id: number, coldOpen: number): EpisodeAudio {
  const pcm = episode([melody(coldOpen, id * 10 + 1), INTRO, melody(400, id * 10 + 2), CREDITS], id);
  const duration = pcm.length / SAMPLE_RATE;
  const h = headWindow(duration);
  const t = tailWindow(duration);
  return { id, duration, head: fingerprint(pcm.subarray(0, Math.round(h.end * SAMPLE_RATE))), tail: fingerprint(pcm.subarray(Math.round(t.start * SAMPLE_RATE))), tailStart: t.start, full: fingerprint(pcm) };
}

let dir: string;
let worker: URL;
beforeAll(async () => {
  // The worker as the release build makes it (one file next to the server).
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-worker-'));
  await build({ entryPoints: [path.resolve('src/season-worker.ts')], outfile: path.join(dir, 'season-worker.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
  worker = pathToFileURL(path.join(dir, 'season-worker.js'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('detecting a season in a thread of its own', () => {
  const eps = [makeEpisode(1, 60), makeEpisode(2, 95), makeEpisode(3, 30)];
  const refs = { intro: [], credits: [] };

  it('finds the same as on the server thread, while the server thread keeps answering', async () => {
    const expected = detectSeason(eps, refs);
    // Timers keep firing during the calculation: the server thread is free (the relay's pings, requests).
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    const started = Date.now();
    const found = await workerSeasonRunner(worker)(eps, refs, new Set([1, 2, 3]), new Map());
    clearInterval(timer);
    expect(found).toEqual(detectSeason(eps, refs, new Set([1, 2, 3])));
    expect([...found.keys()].sort()).toEqual([...expected.keys()].sort());
    expect(found.get(2)!.intro).toMatchObject({ confidence: 'high' });
    expect(ticks).toBeGreaterThan((Date.now() - started) / 5 / 4);
  });

  it('passes on a failure of the calculation itself, without doing it again on the server thread', async () => {
    const failing = path.join(dir, 'failing-worker.mjs');
    fs.writeFileSync(failing, "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', () => parentPort.postMessage({ ok: false, error: 'broken' }));\n");
    // Done here, this would succeed: the failure shows it was not.
    await expect(workerSeasonRunner(pathToFileURL(failing))(eps, refs)).rejects.toThrow('broken');
  });

  it('calculates on the calling thread when there is no built worker (development, tests)', async () => {
    const runner = workerSeasonRunner(pathToFileURL(path.join(dir, 'missing.js')));
    expect(runner).toBe(inlineSeasonRunner);
    expect(await runner(eps, refs)).toEqual(detectSeason(eps, refs));
  });

  it('fingerprints audio in the worker too, the same as here', async () => {
    const pcm = episode([melody(30, 7), INTRO], 3);
    const [a, b] = await workerFingerprintRunner(worker)([pcm, pcm.subarray(0, 10 * SAMPLE_RATE)]);
    expect(a!.words).toEqual(fingerprint(pcm).words);
    expect(b!.words).toEqual(fingerprint(pcm.subarray(0, 10 * SAMPLE_RATE)).words);
    expect(workerFingerprintRunner(pathToFileURL(path.join(dir, 'missing.js')))).toBe(inlineFingerprintRunner);
  });
});
