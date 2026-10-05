import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** True when `target` is `root` itself or lives underneath it (after resolution). */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isFilesystemRoot(target: string): boolean {
  const resolved = path.resolve(target);
  return resolved === path.parse(resolved).root;
}

export function pathsOverlap(first: string, second: string): boolean {
  const resolve = (p: string) => realpathOrNull(p) ?? path.resolve(p);
  const a = resolve(first);
  const b = resolve(second);
  return isInside(a, b) || isInside(b, a);
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
  /** English message (translated when answered); `params` fill its placeholders. */
  error?: string;
  params?: Record<string, string>;
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
  if (!real) {
    // A folder behind one Vidalune may not enter looks missing; say what is really wrong.
    const blocked = blockedAncestor(normalized);
    if (blocked) return noAccess(normalized, blocked);
    return { ok: false, error: 'Folder {path} does not exist inside the container. Check your volume mounts.', params: { path: normalized } };
  }
  if (!fs.statSync(real).isDirectory()) return { ok: false, error: '{path} is not a folder.', params: { path: normalized } };
  if (isFilesystemRoot(real)) return { ok: false, error: 'A library cannot use a filesystem root path.' };
  const roots = mediaRoots.map((r) => realpathOrNull(r) ?? path.resolve(r));
  if (!roots.some((root) => isInside(root, real))) {
    return { ok: false, error: 'Libraries must be inside {roots} (MEDIA_ROOTS).', params: { roots: mediaRoots.join(', ') } };
  }
  if (!canRead(real)) return noAccess(normalized, normalized);
  return { ok: true, resolved: normalized };
}

/** Vidalune may list and enter the folder. */
function canRead(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The highest existing folder above `target` that Vidalune may not enter (null: none). */
function blockedAncestor(target: string): string | null {
  const parts = path.resolve(target).split(path.sep).filter(Boolean);
  let dir: string = path.sep;
  for (const part of parts) {
    try {
      fs.accessSync(dir, fs.constants.X_OK);
    } catch {
      return fs.existsSync(dir) ? dir : null;
    }
    dir = path.join(dir, part);
  }
  return null;
}

/** Installed from the Debian/Ubuntu package: the system user and a ready command can be named. */
const packaged = () => process.env.VIDALUNE_PACKAGE === 'deb';

/**
 * The command that lets the Vidalune service read `target`: enter the folders above it from
 * `blocked` down, and read the folder itself with everything in it (also what is added later).
 */
export function accessCommand(target: string, blocked: string, user = 'vidalune'): string {
  const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
  const lines: string[] = [];
  const above: string[] = [];
  for (let dir = path.dirname(target); isInside(blocked, dir) && dir !== path.dirname(dir); dir = path.dirname(dir)) above.unshift(dir);
  if (above.length) lines.push(`sudo setfacl -m u:${user}:x ${above.map(q).join(' ')}`);
  lines.push(`sudo setfacl -R -m u:${user}:rX ${q(target)}`, `sudo setfacl -R -d -m u:${user}:rX ${q(target)}`);
  return lines.join(' && ');
}

function noAccess(target: string, blocked: string): LibraryPathCheck {
  if (packaged()) return { ok: false, error: 'Vidalune may not read {path}. Give it access on the server with: {command}', params: { path: target, command: accessCommand(target, blocked) } };
  let user = String(process.getuid?.() ?? '');
  try {
    user = os.userInfo().username;
  } catch {
    // A container user without a name: the number says enough.
  }
  return { ok: false, error: 'Vidalune (user {user}) may not read {path}. Give that user read access to it (with Docker: set PUID and PGID to the owner of your media).', params: { path: target, user } };
}

export interface FolderList {
  /** The folder shown (null: the list of MEDIA_ROOTS). */
  path: string | null;
  /** One level up (null at a media root). */
  parent: string | null;
  folders: { name: string; path: string; readable: boolean }[];
}

/**
 * The folders an administrator can choose a library from: MEDIA_ROOTS first, then the folders
 * inside one of them (hidden ones left out). Never anything outside MEDIA_ROOTS, and no files.
 */
export function listFolders(dir: string | undefined, mediaRoots: string[]): FolderList | { error: string; params?: Record<string, string> } {
  const roots = mediaRoots.map((r) => path.resolve(r));
  if (!dir) {
    return { path: null, parent: null, folders: roots.filter((r) => fs.existsSync(r)).map((r) => ({ name: r, path: r, readable: canRead(r) })) };
  }
  if (dir.includes('\0') || !path.isAbsolute(dir)) return { error: 'Invalid path.' };
  const target = path.resolve(dir);
  const real = realpathOrNull(target);
  const realRoots = roots.map((r) => realpathOrNull(r) ?? r);
  if (!real || !realRoots.some((r) => isInside(r, real))) return { error: 'Libraries must be inside {roots} (MEDIA_ROOTS).', params: { roots: mediaRoots.join(', ') } };
  if (!canRead(real)) return noAccess(target, target) as { error: string; params?: Record<string, string> };
  const atRoot = roots.includes(target);
  const folders = fs
    .readdirSync(real, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    .filter((e) => {
      try {
        return fs.statSync(e.path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, 1000)
    .map((e) => ({ ...e, readable: canRead(e.path) }));
  return { path: target, parent: atRoot ? null : path.dirname(target), folders };
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
