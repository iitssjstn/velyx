import fs from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { optimizedMedia } from '../db/schema.js';

/**
 * A compatible copy made by the optimizer lives next to the film it was made from, as
 * "<name>.vidalune-1080p.mp4", so it is easy to find. The scanner and folder watcher skip that
 * name: it is never a second file of the same film.
 */
// Also while it is being written ("….vidalune-1080p.mp4.<pid>.partial.mp4").
const COPY = /\.vidalune-(720p|1080p)\.mp4(\.\d+\.partial\.mp4)?$/i;

export function isOptimizedCopy(file: string): boolean {
  return COPY.test(path.basename(file));
}

/** Where the copy of `source` goes, for profile 'compat-720p' or 'compat-1080p'. */
export function copyBeside(source: string, profile: 'compat-720p' | 'compat-1080p'): string {
  const { dir, name } = path.parse(source);
  return path.join(dir, `${name}.vidalune-${profile.replace('compat-', '')}.mp4`);
}

/** The folder can take the copy (a library mounted with :ro cannot). */
export function canWriteBeside(source: string): boolean {
  try {
    fs.accessSync(path.dirname(source), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Removes the copies made next to these files, before the files leave the library. */
export function removeCopiesBeside(db: DB, mediaFileIds: number[]): void {
  for (let i = 0; i < mediaFileIds.length; i += 500) {
    const rows = db.select({ path: optimizedMedia.outputPath }).from(optimizedMedia).where(inArray(optimizedMedia.mediaFileId, mediaFileIds.slice(i, i + 500))).all();
    for (const row of rows) {
      if (!isOptimizedCopy(row.path)) continue;
      try {
        fs.rmSync(row.path, { force: true });
      } catch {
        // A copy that cannot be removed now (read-only, gone) is left; nothing points to it any more.
      }
    }
  }
}
