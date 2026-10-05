// Writes .br and .gz copies of the built scripts, styles and other text files, so the server can send
// them compressed without compressing anything per request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TEXT = /\.(?:js|css|svg|json|webmanifest|txt)$/;
let saved = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (TEXT.test(entry.name)) compress(file);
  }
}

function compress(file) {
  const data = fs.readFileSync(file);
  if (data.length < 1024) return;
  const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  const gz = zlib.gzipSync(data, { level: 9 });
  if (br.length < data.length) fs.writeFileSync(`${file}.br`, br);
  if (gz.length < data.length) fs.writeFileSync(`${file}.gz`, gz);
  saved += data.length - br.length;
}

walk(dist);
console.log(`precompressed: ${(saved / 1024).toFixed(0)} KB less to send with brotli`);
