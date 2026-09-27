// The build of the account service: one minified file (dist/index.js). Packages from node_modules
// stay separate (native modules such as better-sqlite3 load from there).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
