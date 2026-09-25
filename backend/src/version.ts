import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Single source of truth: backend/package.json "version" (kept in sync with the root package). */
export const APP_VERSION = readVersion();
export const APP_NAME = 'Velyx';
export const APP_TAGLINE = 'Your media. Your server.';
