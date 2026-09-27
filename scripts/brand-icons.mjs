#!/usr/bin/env node
// Renders every Vidalune icon (web, installable web app, Android app) from one drawing.
// Usage: node scripts/brand-icons.mjs [path-to-chromium]   (needs a Chromium/Chrome binary)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BG = '#14121C';
const ACCENT = '#B69CFF';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const chrome = process.argv[2] ?? process.env.CHROME ?? 'chromium';

/** The mark (crescent moon with a play button in its hollow), centred in a 64×64 box. */
function mark(color, id) {
  return `<mask id="${id}"><rect width="64" height="64" fill="white"/><circle cx="43" cy="32" r="17" fill="black"/></mask>` +
    `<circle cx="35" cy="32" r="20" fill="${color}" mask="url(#${id})"/><path d="M37 24l12 8-12 8z" fill="${color}"/>`;
}

/** An SVG of the mark scaled to `scale` of the canvas, on an optional background. */
function svg({ scale = 1, bg = null, radius = 0, color = ACCENT, id = 'm' } = {}) {
  const t = 32 - 32 * scale;
  const back = bg ? `<rect width="64" height="64" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${back}<g transform="translate(${t} ${t}) scale(${scale})">${mark(color, id)}</g></svg>`;
}

const outputs = [
  // Browser tab and installed web app.
  { file: 'frontend/public/favicon.svg', svg: svg({ bg: BG, radius: 16 }) },
  { file: 'frontend/public/icon-192.png', size: 192, svg: svg({ bg: BG, radius: 16 }) },
  { file: 'frontend/public/icon-512.png', size: 512, svg: svg({ bg: BG, radius: 16 }) },
  { file: 'frontend/public/icon-maskable-512.png', size: 512, svg: svg({ bg: BG, scale: 0.8 }) },
  { file: 'frontend/public/apple-touch-icon.png', size: 180, svg: svg({ bg: BG, scale: 0.9 }) },
  // Android app (adaptive icon: the foreground must fit the inner 66%).
  { file: 'app/assets/icon.png', size: 1024, svg: svg({ bg: BG, scale: 0.9 }) },
  { file: 'app/assets/android-icon-background.png', size: 1024, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/></svg>` },
  { file: 'app/assets/android-icon-foreground.png', size: 1024, svg: svg({ scale: 0.62 }) },
  { file: 'app/assets/android-icon-monochrome.png', size: 1024, svg: svg({ scale: 0.62, color: '#FFFFFF' }) },
  { file: 'app/assets/splash-icon.png', size: 1024, svg: svg({ scale: 0.9 }) },
  { file: 'app/assets/favicon.png', size: 48, svg: svg({ bg: BG, radius: 12 }) },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
for (const o of outputs) {
  const target = path.join(root, o.file);
  if (!o.size) {
    fs.writeFileSync(target, o.svg + '\n');
    continue;
  }
  const html = path.join(tmp, 'icon.html');
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${o.svg.replace('<svg ', `<svg width="${o.size}" height="${o.size}" style="display:block" `)}</body></html>`);
  execFileSync(chrome, ['--headless', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${o.size},${o.size}`, `--screenshot=${target}`, `file://${html}`], { stdio: 'ignore' });
  console.log(`${o.file} (${o.size}px)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
