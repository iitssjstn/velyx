import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { VideoEncode } from '../playback/remux.js';

const stateSchema = z.object({
  sourceSize: z.number().nonnegative(),
  sourceMtimeMs: z.number().nonnegative(),
  durationSec: z.number().positive(),
  video: z.object({ input: z.array(z.string()), output: z.array(z.string()) }),
  segmentSeconds: z.number().positive(),
  complete: z.boolean().default(false),
  runStartSec: z.number().nonnegative(),
  parts: z.array(z.object({ name: z.string().regex(/^part-\d{6}\.ts$/), endSec: z.number().positive() })),
});

export class OptimizationCheckpoint {
  readonly directory: string;
  readonly list: string;
  private state: z.infer<typeof stateSchema>;

  constructor(outputPath: string, options: { sourceSize: number; sourceMtimeMs: number; durationSec: number; video: VideoEncode; segmentSeconds?: number }) {
    this.directory = `${outputPath}.parts`;
    this.list = path.join(this.directory, 'active.csv');
    this.state = { ...options, segmentSeconds: options.segmentSeconds ?? 60, complete: false, runStartSec: 0, parts: [] };
    try {
      const saved = stateSchema.parse(JSON.parse(fs.readFileSync(path.join(this.directory, 'checkpoint.json'), 'utf8')));
      if (saved.sourceSize === options.sourceSize && saved.sourceMtimeMs === options.sourceMtimeMs && saved.durationSec === options.durationSec) this.state = saved;
      else fs.rmSync(this.directory, { recursive: true, force: true });
    } catch {
      fs.rmSync(this.directory, { recursive: true, force: true });
    }
    fs.mkdirSync(this.directory, { recursive: true });
    this.capture(false);
    const missing = this.state.parts.findIndex((part) => !fs.existsSync(path.join(this.directory, part.name)));
    if (missing >= 0) {
      this.state.parts.splice(missing);
      this.state.complete = false;
    }
    this.save();
  }

  get offset(): number { return this.state.parts.at(-1)?.endSec ?? 0; }
  get video(): VideoEncode { return this.state.video; }
  get segmentSeconds(): number { return this.state.segmentSeconds; }
  get nextIndex(): number { return this.state.parts.length; }
  get complete(): boolean { return this.state.complete; }

  prepare(): void {
    const kept = new Set(this.state.parts.map((part) => part.name));
    for (const name of fs.readdirSync(this.directory)) {
      if (name !== 'checkpoint.json' && !kept.has(name)) fs.rmSync(path.join(this.directory, name), { force: true });
    }
    this.state.runStartSec = this.offset;
    this.state.complete = false;
    this.save();
  }

  capture(finished: boolean): void {
    let rows: string[][];
    try {
      rows = parse(fs.readFileSync(this.list, 'utf8'), { skip_empty_lines: true });
    } catch {
      return;
    }
    for (const row of rows) {
      if (row.length !== 3) break;
      const name = path.basename(row[0]!);
      const match = /^part-(\d{6})\.ts$/.exec(name);
      if (!match) break;
      const index = Number(match[1]);
      if (index < this.nextIndex) continue;
      const start = Number(row[1]);
      const end = Number(row[2]);
      if (index !== this.nextIndex || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) break;
      // FFmpeg can close a short final segment on SIGTERM; it is not a completed checkpoint.
      if (!finished && end - start < this.segmentSeconds - 0.001) break;
      const endSec = Math.min(this.state.durationSec, this.state.runStartSec + end);
      if (endSec <= this.offset || !fs.existsSync(path.join(this.directory, name))) break;
      this.state.parts.push({ name, endSec });
    }
    if (finished) this.state.complete = this.nextIndex > 0 && this.offset >= this.state.durationSec - 1;
    this.save();
  }

  concatList(): string {
    const file = path.join(this.directory, 'concat.txt');
    fs.writeFileSync(file, this.state.parts.map((part) => `file '${part.name}'`).join('\n') + '\n');
    return file;
  }

  private save(): void {
    const file = path.join(this.directory, 'checkpoint.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.state));
    fs.renameSync(`${file}.tmp`, file);
  }
}