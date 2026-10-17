import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * The Windows tray program starts the server itself. It learns from a small status file whether
 * someone is watching (it then keeps the PC awake and asks before quitting), and it asks the
 * server to stop by closing the server's input.
 */
export interface TrayStatus {
  watching: number;
  updatedAt: number;
}

/** Writes the status file atomically, so the tray program never reads half of it. */
export function writeTrayStatus(file: string, status: TrayStatus): void {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(status));
  fs.renameSync(tmp, file);
}

export interface TrayBridgeOptions {
  /** STATUS_FILE: where the status goes (no file without it). */
  statusFile?: string;
  /** STOP_ON_STDIN_END=1: stop when the tray program closes the server's input. */
  stopOnStdinEnd?: boolean;
  watching: () => number;
  stop: (reason: string) => void;
  stdin?: Readable;
  intervalMs?: number;
}

/** Starts what the tray program needs; returns a function that ends it. Does nothing without a tray. */
export function startTrayBridge(opts: TrayBridgeOptions): () => void {
  let timer: NodeJS.Timeout | null = null;
  if (opts.statusFile) {
    const file = opts.statusFile;
    const write = () => {
      try {
        writeTrayStatus(file, { watching: opts.watching(), updatedAt: Date.now() });
      } catch {
        // The next round tries again.
      }
    };
    write();
    timer = setInterval(write, opts.intervalMs ?? 5000);
    timer.unref();
  }
  if (opts.stopOnStdinEnd) {
    const stdin = opts.stdin ?? process.stdin;
    stdin.on('end', () => opts.stop('input closed'));
    stdin.on('error', () => opts.stop('input closed'));
    stdin.resume();
  }
  return () => {
    if (timer) clearInterval(timer);
  };
}
