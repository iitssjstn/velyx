// The release build of the server: one minified file per entry point (dist/index.js, dist/cli.js).
// Packages from node_modules stay separate (native modules such as better-sqlite3 load from there).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
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
