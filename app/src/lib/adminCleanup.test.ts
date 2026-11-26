import { describe, expect, it } from 'vitest';
import {
  allSelected,
  backupKindKey,
  candidateFacts,
  clampRules,
  cleanupPath,
  deleteMessage,
  deleteOutcome,
  dueText,
  DELETE_LIST_MAX,
  EMPTY_RULE,
  hasCondition,
  hourLabel,
  numberInput,
  pageCount,
  ruleChipLabel,
  ruleSummary,
  ruleValid,
  toggleSelected,
  togglePage,
  totalBytes,
  verifyLine,
  visibleRules,
  watchStatus,
  withoutRule,
  withRule,
  type CleanupCandidate,
  type CleanupList,
  type OwnRule,
} from './adminCleanup';
import { translator } from './i18n';

const t = translator('en');
const NOW = Date.UTC(2026, 10, 25, 12);
const DAY = 86_400_000;

const file = (id: number, size = 1e9): CleanupCandidate => ({
  fileId: id,
  libraryId: 1,
  library: 'Movies',
  kind: 'movie',
  title: `Film ${id}`,
  subtitle: null,
  href: null,
  path: `/media/movies/film${id}.mkv`,
  size,
  width: 1920,
  height: 1080,
  addedAt: NOW - 3 * DAY,
  watchedBy: 0,
  started: false,
  lastWatchedAt: null,
  reasons: [],
});

const summary: CleanupList['summary'] = {
  rules: { unwatched: { enabled: true, days: 90 }, stale: { enabled: false, days: 365 }, large: { enabled: true, gb: 30 }, duplicates: { enabled: true }, missingInfo: { enabled: true } },
  custom: [],
  counts: { unwatched: { files: 12, bytes: 1 } },
  total: { files: 12, bytes: 1 },
  kept: 0,
};

describe('clean-up list', () => {
  it('builds the address with only the filters that are set', () => {
    expect(cleanupPath({ rule: null, libraryId: null, page: 1 })).toBe('/api/admin/cleanup?page=1&limit=50');
    expect(cleanupPath({ rule: 'large', libraryId: 3, page: 2 })).toBe('/api/admin/cleanup?page=2&limit=50&rule=large&libraryId=3');
  });

  it('counts pages, at least one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
  });

  it('shows "your own rules" only once there is one', () => {
    expect(visibleRules(summary)).not.toContain('custom');
    expect(visibleRules({ custom: [EMPTY_RULE] })).toContain('custom');
  });

  it('labels a filter with its count, or off', () => {
    expect(ruleChipLabel(summary, 'unwatched', t)).toBe('Never watched · 12');
    expect(ruleChipLabel(summary, 'large', t)).toBe('Very large files · 0');
    expect(ruleChipLabel(summary, 'stale', t)).toBe('Not watched in a long time · off');
    expect(ruleChipLabel({ ...summary, custom: [{ ...EMPTY_RULE, enabled: false }] }, 'custom', t)).toBe('Your own rules · off');
  });

  it('says who watched it', () => {
    expect(watchStatus(file(1), t, NOW)).toBe('Never watched');
    expect(watchStatus({ started: true, watchedBy: 0, lastWatchedAt: null }, t, NOW)).toBe('Started, not finished');
    expect(watchStatus({ started: true, watchedBy: 1, lastWatchedAt: null }, t, NOW)).toBe('Watched by 1 user');
    expect(watchStatus({ started: true, watchedBy: 2, lastWatchedAt: NOW - 3 * DAY }, t, NOW)).toBe('Watched by 2 users · last 3 days ago');
  });

  it('puts the facts of a file on one line', () => {
    expect(candidateFacts({ ...file(1), format: 'HEVC · 2160p' }, t, NOW)).toBe('HEVC · 2160p · Never watched · added 3 days ago · Movies');
    expect(candidateFacts(file(1), t, NOW)).toBe('1080p · Never watched · added 3 days ago · Movies');
  });

  it('says when a planned deletion happens', () => {
    expect(dueText(NOW - 1, NOW, t, 'en')).toBe('as soon as deleting is allowed');
    expect(dueText(NOW + 7 * DAY, NOW, t, 'en')).toMatch(/^on .*2026/);
  });
});

describe('selecting', () => {
  it('toggles one file without changing the old map', () => {
    const a = file(1);
    const empty = new Map<number, CleanupCandidate>();
    const one = toggleSelected(empty, a);
    expect(one.has(1)).toBe(true);
    expect(empty.size).toBe(0);
    expect(toggleSelected(one, a).has(1)).toBe(false);
  });

  it('selects the whole page, then unselects it, keeping other pages', () => {
    const page = [file(1), file(2)];
    const other = new Map([[9, file(9)]]);
    const all = togglePage(other, page);
    expect([...all.keys()].sort()).toEqual([1, 2, 9]);
    expect(allSelected(all, page)).toBe(true);
    expect([...togglePage(all, page).keys()]).toEqual([9]);
    expect(allSelected(new Map(), [])).toBe(false);
  });

  it('adds up sizes', () => {
    expect(totalBytes([file(1, 2e9), file(2, 5e8)])).toBe(2.5e9);
  });
});

describe('deleting', () => {
  it('names every file, the size and that it cannot be undone', () => {
    const text = deleteMessage([file(1, 2e9), file(2, 1e9)], t);
    expect(text).toContain('These 2 files are removed from disk (3.0 GB)');
    expect(text).toContain('/media/movies/film1.mkv (2.0 GB)');
    expect(text).toContain('/media/movies/film2.mkv');
    expect(text).toContain('cannot be undone');
    expect(text).toContain('deleted permanently');
  });

  it('counts what does not fit in the list', () => {
    const many = Array.from({ length: DELETE_LIST_MAX + 3 }, (_, i) => file(i + 1));
    const text = deleteMessage(many, t);
    expect(text).toContain('… and 3 more');
    expect(text).not.toContain(`film${DELETE_LIST_MAX + 1}.mkv`);
  });

  it('tells what was deleted and what failed', () => {
    const text = deleteOutcome(
      [
        { fileId: 1, path: '/a.mkv', size: 1e9, ok: true, error: null },
        { fileId: 2, path: null, size: 0, ok: false, error: 'Someone is watching this file right now.' },
      ],
      t,
    );
    expect(text).toBe('Files deleted: 1 (1.0 GB).\nFile 2: Someone is watching this file right now.');
  });
});

describe('own rules', () => {
  const rule: OwnRule = { ...EMPTY_RULE, name: 'Seen', watched: 'everyone', addedDays: 30, action: 'delete', graceDays: 7 };

  it('needs a name and a condition', () => {
    expect(ruleValid(rule)).toBe(true);
    expect(ruleValid({ ...rule, name: '  ' })).toBe(false);
    expect(hasCondition({ watched: 'any', addedDays: null, notPlayedDays: null, minGb: null })).toBe(false);
    expect(hasCondition({ watched: 'any', addedDays: null, notPlayedDays: null, minGb: 2 })).toBe(true);
  });

  it('sums a rule up', () => {
    expect(ruleSummary(rule, t)).toBe('watched by everyone · added 30+ days ago · deletes after 7 days');
    expect(ruleSummary({ ...rule, watched: 'any', addedDays: null, minGb: 2.5, action: 'suggest' }, t)).toBe('larger than 2.5 GB · suggests');
    expect(ruleSummary({ ...rule, enabled: false }, t)).toMatch(/· off$/);
  });

  it('adds, replaces and removes a rule', () => {
    const list = [rule];
    const b = { ...rule, name: 'B' };
    expect(withRule(list, null, b).map((r) => r.name)).toEqual(['Seen', 'B']);
    expect(withRule(list, 0, b).map((r) => r.name)).toEqual(['B']);
    expect(withoutRule([rule, b], 0).map((r) => r.name)).toEqual(['B']);
  });
});

describe('number fields', () => {
  it('reads what is typed within the limits', () => {
    expect(numberInput('45', { min: 1, max: 3650 })).toBe(45);
    expect(numberInput('0', { min: 1, max: 3650 })).toBe(1);
    expect(numberInput('99999', { min: 1, max: 3650 })).toBe(3650);
    expect(numberInput('', { min: 1, max: 10, optional: true })).toBeNull();
    expect(numberInput('', { min: 1, max: 10 })).toBe(1);
    expect(numberInput('2,55', { min: 0.1, max: 10_000, decimals: true })).toBe(2.6);
    expect(numberInput('abc', { min: 1, max: 10, optional: true })).toBeNull();
  });

  it('keeps built-in rules inside what the server accepts', () => {
    const r = clampRules({ ...summary.rules, unwatched: { enabled: true, days: 0 }, large: { enabled: true, gb: 0 } });
    expect(r.unwatched.days).toBe(1);
    expect(r.large.gb).toBe(1);
  });
});

describe('backup', () => {
  it('names each kind and hour', () => {
    expect(t(backupKindKey('pre-restore'))).toBe('Before restore');
    expect(t(backupKindKey('auto'))).toBe('Scheduled');
    expect(hourLabel(3)).toBe('03:00');
  });

  it('says what a check found', () => {
    expect(verifyLine({ ok: true, errors: [], info: { size: 1, migrations: 3, users: 2, movies: 40, shows: null } }, t)).toBe('Verified: 2 users, 40 movies, ? shows');
    expect(verifyLine({ ok: false, errors: ['Not a database.', 'Too old.'], info: null }, t)).toBe('Not a database. Too old.');
  });
});
