import fs from 'node:fs';
import path from 'node:path';

/** True when `target` is `root` itself or lives underneath it (after resolution). */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export interface LibraryPathCheck {
  ok: boolean;
  error?: string;
  resolved?: string;
}

/**
 * Validates a library path supplied by an administrator. It must be absolute, exist, be a directory,
 * and live inside one of the configured MEDIA_ROOTS so the HTTP API can never expose e.g. /etc.
 */
export function validateLibraryPath(input: string, mediaRoots: string[]): LibraryPathCheck {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Path is required.' };
  if (input.includes('\0')) return { ok: false, error: 'Invalid path.' };
  if (!path.isAbsolute(input)) return { ok: false, error: 'Use an absolute path inside the container, e.g. /media/movies.' };
  const normalized = path.resolve(input);
  const real = realpathOrNull(normalized);
  if (!real) return { ok: false, error: `Folder ${normalized} does not exist inside the container. Check your volume mounts.` };
  if (!fs.statSync(real).isDirectory()) return { ok: false, error: `${normalized} is not a folder.` };
  const roots = mediaRoots.map((r) => realpathOrNull(r) ?? path.resolve(r));
  if (!roots.some((root) => isInside(root, real))) {
    return { ok: false, error: `Libraries must be inside ${mediaRoots.join(', ')} (MEDIA_ROOTS).` };
  }
  return { ok: true, resolved: normalized };
}

/**
 * Resolves a stored media path and verifies that it is still inside its library root.
 * Protects streaming routes against symlink escapes and tampered database rows.
 */
export function resolveMediaPath(libraryRoot: string, filePath: string): string | null {
  const realRoot = realpathOrNull(libraryRoot);
  const realFile = realpathOrNull(filePath);
  if (!realRoot || !realFile) return null;
  if (!isInside(realRoot, realFile)) return null;
  return realFile;
}
