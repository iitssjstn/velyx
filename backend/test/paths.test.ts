import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accessCommand, isFilesystemRoot, isInside, listFolders, pathsOverlap, resolveMediaPath, validateLibraryPath } from '../src/services/paths.js';
import { isValidImageRequest } from '../src/services/images.js';

describe('path helpers', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-paths-'));
    fs.mkdirSync(path.join(tmp, 'media', 'movies'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'secret'));
    fs.writeFileSync(path.join(tmp, 'secret', 'passwd'), 'root:x');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('isInside handles prefixes and traversal', () => {
    expect(isInside('/media', '/media/movies/a.mkv')).toBe(true);
    expect(isInside('/media', '/media')).toBe(true);
    expect(isInside('/media', '/media2/a.mkv')).toBe(false);
    expect(isInside('/media', '/media/../etc/passwd')).toBe(false);
  });

  it('recognizes filesystem roots and detects overlap after resolving paths', () => {
    const movies = path.join(tmp, 'media', 'movies');
    expect(isFilesystemRoot(path.parse(path.resolve('/')).root)).toBe(true);
    expect(isFilesystemRoot(movies)).toBe(false);
    expect(pathsOverlap(movies, path.join(movies, 'nested'))).toBe(true);
    expect(pathsOverlap(movies, path.join(tmp, 'media', 'movies-extra'))).toBe(false);
  });

  it('validateLibraryPath only accepts existing folders inside MEDIA_ROOTS', () => {
    const roots = [path.join(tmp, 'media')];
    expect(validateLibraryPath(path.join(tmp, 'media', 'movies'), roots).ok).toBe(true);
    expect(validateLibraryPath(path.join(tmp, 'secret'), roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', 'nope'), roots).ok).toBe(false);
    expect(validateLibraryPath('media/movies', roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', '..', 'secret'), roots).ok).toBe(false);
    expect(validateLibraryPath(path.join(tmp, 'media', 'movies\0'), roots).ok).toBe(false);
    const systemRoot = path.parse(path.resolve('/')).root;
    expect(validateLibraryPath(systemRoot, [systemRoot])).toMatchObject({ ok: false, error: 'A library cannot use a filesystem root path.' });
  });

  it('lists only folders inside MEDIA_ROOTS to choose a library from', () => {
    const roots = [path.join(tmp, 'media')];
    fs.mkdirSync(path.join(tmp, 'media', 'series'));
    fs.mkdirSync(path.join(tmp, 'media', '.hidden'));
    fs.writeFileSync(path.join(tmp, 'media', 'file.mkv'), 'x');
    expect(listFolders(undefined, roots)).toEqual({ path: null, parent: null, folders: [{ name: roots[0], path: roots[0], readable: true }] });
    expect(listFolders(roots[0], roots)).toEqual({
      path: roots[0],
      parent: null,
      folders: [
        { name: 'movies', path: path.join(roots[0], 'movies'), readable: true },
        { name: 'series', path: path.join(roots[0], 'series'), readable: true },
      ],
    });
    expect(listFolders(path.join(roots[0], 'movies'), roots)).toMatchObject({ parent: roots[0], folders: [] });
    expect(listFolders(path.join(tmp, 'secret'), roots)).toHaveProperty('error');
    expect(listFolders(path.join(roots[0], '..', 'secret'), roots)).toHaveProperty('error');
    expect(listFolders('media', roots)).toHaveProperty('error');
    fs.symlinkSync(path.join(tmp, 'secret'), path.join(tmp, 'media', 'link'));
    expect(listFolders(path.join(tmp, 'media', 'link'), roots)).toHaveProperty('error');
  });

  it('names the command that lets the service read a folder, also through the folders above it', () => {
    expect(accessCommand('/srv/media/movies', '/srv/media/movies')).toBe("sudo setfacl -R -m u:vidalune:rX '/srv/media/movies' && sudo setfacl -R -d -m u:vidalune:rX '/srv/media/movies'");
    expect(accessCommand("/home/jan/Jan's films", '/home/jan')).toBe(
      "sudo setfacl -m u:vidalune:x '/home/jan' && sudo setfacl -R -m u:vidalune:rX '/home/jan/Jan'\\''s films' && sudo setfacl -R -d -m u:vidalune:rX '/home/jan/Jan'\\''s films'",
    );
  });

  it('validateLibraryPath rejects symlinks that point outside MEDIA_ROOTS', () => {
    fs.symlinkSync(path.join(tmp, 'secret'), path.join(tmp, 'media', 'link'));
    expect(validateLibraryPath(path.join(tmp, 'media', 'link'), [path.join(tmp, 'media')]).ok).toBe(false);
  });

  it('resolveMediaPath blocks symlink escapes out of the library', () => {
    const lib = path.join(tmp, 'media', 'movies');
    fs.writeFileSync(path.join(lib, 'ok.mkv'), 'x');
    fs.symlinkSync(path.join(tmp, 'secret', 'passwd'), path.join(lib, 'evil.mkv'));
    expect(resolveMediaPath(lib, path.join(lib, 'ok.mkv'))).toBe(fs.realpathSync(path.join(lib, 'ok.mkv')));
    expect(resolveMediaPath(lib, path.join(lib, 'evil.mkv'))).toBeNull();
    expect(resolveMediaPath(lib, path.join(tmp, 'secret', 'passwd'))).toBeNull();
    expect(resolveMediaPath(lib, path.join(lib, 'missing.mkv'))).toBeNull();
  });

  it('image requests only accept whitelisted sizes and plain file names', () => {
    expect(isValidImageRequest('w342', 'abc.jpg')).toBe(true);
    expect(isValidImageRequest('w9999', 'abc.jpg')).toBe(false);
    expect(isValidImageRequest('w342', '../../etc/passwd')).toBe(false);
    expect(isValidImageRequest('w342', '..%2Fx.jpg')).toBe(false);
    expect(isValidImageRequest('w342', 'x.exe')).toBe(false);
  });
});