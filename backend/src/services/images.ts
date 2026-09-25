import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('images');

export const IMAGE_SIZES = new Set(['w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'w1280', 'original']);
const FILE_RE = /^[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|webp|svg)$/;

export function isValidImageRequest(size: string, file: string): boolean {
  return IMAGE_SIZES.has(size) && FILE_RE.test(file);
}

/**
 * Local artwork cache in front of TMDB's image CDN. Artwork is stored under
 * DATA_DIR/cache/images/<size>/<file> and served from disk from then on, so the
 * library keeps working when TMDB is unavailable.
 */
export class ImageCache {
  private inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  localPath(size: string, file: string): string {
    return path.join(this.dir, size, file);
  }

  /** Returns the local file path, downloading it first when needed. Returns null when unavailable. */
  async get(size: string, tmdbPath: string | null | undefined): Promise<string | null> {
    if (!tmdbPath) return null;
    const file = tmdbPath.replace(/^\//, '');
    if (!isValidImageRequest(size, file)) return null;
    const target = this.localPath(size, file);
    if (fs.existsSync(target)) return target;
    const key = `${size}/${file}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.download(size, file, target).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async download(size: string, file: string, target: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`https://image.tmdb.org/t/p/${size}/${file}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        log.warn(`Artwork ${size}/${file} unavailable (HTTP ${res.status})`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, target);
      return target;
    } catch (err) {
      log.warn(`Could not download artwork ${size}/${file}`, err);
      return null;
    }
  }

  /** Pre-fetches artwork without failing the caller. */
  async prefetch(items: Array<[string, string | null | undefined]>): Promise<void> {
    for (const [size, p] of items) {
      if (p) await this.get(size, p);
    }
  }

  async sizeOnDisk(): Promise<number> {
    let total = 0;
    const walk = async (d: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else total += (await fsp.stat(p)).size;
      }
    };
    await walk(this.dir);
    return total;
  }
}
