import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTrayBridge, writeTrayStatus } from '../src/services/tray.js';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-tray-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('Windows tray program', () => {
  it('tells it how many people are watching, and keeps it up to date', () => {
    vi.useFakeTimers();
    const file = path.join(tmp(), 'status.json');
    let watching = 0;
    const stop = startTrayBridge({ statusFile: file, watching: () => watching, stop: () => {}, intervalMs: 1000 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ watching: 0 });
    watching = 2;
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ watching: 2 });
    stop();
    watching = 5;
    vi.advanceTimersByTime(5000);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ watching: 2 });
  });

  it('writes the whole file at once and leaves no half-written copy behind', () => {
    const file = path.join(tmp(), 'nested', 'status.json');
    writeTrayStatus(file, { watching: 1, updatedAt: 42 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ watching: 1, updatedAt: 42 });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('stops the server when the tray program closes its input, also when the tray program is gone', () => {
    const stdin = new PassThrough();
    const stop = vi.fn();
    startTrayBridge({ stopOnStdinEnd: true, stdin, watching: () => 0, stop });
    expect(stop).not.toHaveBeenCalled();
    stdin.end();
    return new Promise<void>((resolve) => setImmediate(() => {
      expect(stop).toHaveBeenCalledWith('input closed');
      resolve();
    }));
  });

  it('does nothing without the tray program (Docker and .deb)', () => {
    const stop = vi.fn();
    const stdin = new PassThrough();
    startTrayBridge({ stdin, watching: () => 0, stop });
    stdin.end();
    expect(stop).not.toHaveBeenCalled();
    expect(stdin.listenerCount('end')).toBe(0);
  });
});
