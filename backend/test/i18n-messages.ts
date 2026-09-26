import fs from 'node:fs';
import path from 'node:path';
import { HEALTH_CATEGORIES } from '../src/services/library-health.js';

const SRC = path.join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const LITERAL = /'((?:[^'\\]|\\.)*)'/g;
const literals = (line: string) => [...line.matchAll(LITERAL)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\"/g, '"'));

/** Every text the server can answer with: errors, validation messages and translated explanations. */
export function serverMessages(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      if (/HttpError\(|badRequest\(|\.refine\(|\.regex\(|message: '|return '[A-Z]|error: '[A-Z]|fail\('|row\(/.test(line)) {
        for (const l of literals(line)) if (/^[A-Z{].* /.test(l) && !l.includes('${')) found.add(l);
      }
      for (const m of line.matchAll(/notFound\('([^']+)'\)/g)) found.add(`${m[1]} not found.`);
      if (line.includes('notFound()')) found.add('Item not found.');
      // tr(lang, '…'), tr(requestLanguage(request), '…') and T('…') helpers, including ternaries.
      for (const m of line.matchAll(/\b(?:tr\((?:\w+|requestLanguage\(\w+\)), |T\()((?:'(?:[^'\\]|\\.)*'(?: : | \? |[^']*?\? )?)+)/g)) {
        for (const l of literals(m[1])) found.add(l);
      }
    }
  }
  for (const c of HEALTH_CATEGORIES) {
    found.add(c.label);
    found.add(c.description);
  }
  return [...found].sort();
}

