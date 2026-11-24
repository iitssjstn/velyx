import { describe, expect, it } from 'vitest';
import {
  analyzedFraction,
  auditLabel,
  auditPath,
  fileName,
  filterLogs,
  openReports,
  reviewList,
  segmentShowsByNeed,
  statusLine,
  type LogEntry,
  type ReviewItem,
  type SegmentShow,
  type ShowSegments,
} from './adminPages';

const log = (level: LogEntry['level'], module: string, message: string): LogEntry => ({ time: '2026-11-24T10:00:00Z', level, module, message });

describe('log', () => {
  const lines = [log('info', 'scan', 'Scan started'), log('warn', 'tmdb', 'Slow answer'), log('error', 'ffmpeg', 'Exited with 1')];

  it('keeps a level or worse, newest first', () => {
    expect(filterLogs(lines, 'all', '').map((l) => l.module)).toEqual(['ffmpeg', 'tmdb', 'scan']);
    expect(filterLogs(lines, 'warn', '').map((l) => l.module)).toEqual(['ffmpeg', 'tmdb']);
    expect(filterLogs(lines, 'error', '').map((l) => l.module)).toEqual(['ffmpeg']);
  });

  it('finds text in the message or the module', () => {
    expect(filterLogs(lines, 'all', 'SLOW').map((l) => l.module)).toEqual(['tmdb']);
    expect(filterLogs(lines, 'all', 'scan').map((l) => l.module)).toEqual(['scan']);
  });
});

describe('audit log', () => {
  it('asks a page, with a group only when one is chosen', () => {
    expect(auditPath(2, '')).toBe('/api/admin/audit?page=2&limit=50');
    expect(auditPath(1, 'login.')).toBe('/api/admin/audit?page=1&limit=50&action=login.');
  });

  it('says what happened in the language of the app, or the action itself', () => {
    expect(auditLabel('login.success', 'en')).toBe('Signed in');
    expect(auditLabel('login.success', 'nl')).toBe('Ingelogd');
    expect(auditLabel('something.new', 'nl')).toBe('something.new');
  });
});

describe('metadata to check', () => {
  const item = (id: number, type: ReviewItem['type'], title: string, confidence: number | null): ReviewItem => ({ id, type, title, parsedTitle: title, parsedYear: null, status: 'unmatched', confidence, samplePath: null });

  it('puts movies and shows together, the least sure first', () => {
    const list = reviewList({ movies: [item(1, 'movie', 'B', 0.6), item(2, 'movie', 'A', null)], shows: [item(3, 'show', 'C', 0.4)] });
    expect(list.map((i) => i.id)).toEqual([2, 3, 1]);
    expect(reviewList(undefined)).toEqual([]);
  });

  it('shows only the name of a file', () => {
    expect(fileName('/media/movies/Heat (1995)/heat.mkv')).toBe('heat.mkv');
    expect(fileName('D:\\Films\\heat.mkv')).toBe('heat.mkv');
    expect(fileName(null)).toBeNull();
  });
});

describe('intros and credits', () => {
  const show = (id: number, title: string, episodes: number, analyzed: number, errors = 0, low = 0): SegmentShow => ({ id, title, episodes, analyzed, intros: 0, credits: 0, errors, manual: 0, low });

  it('puts shows with problems first, then the least done', () => {
    const sorted = segmentShowsByNeed([show(1, 'Done', 10, 10), show(2, 'Half', 10, 5), show(3, 'Errors', 10, 10, 2)]);
    expect(sorted.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(analyzedFraction(show(4, 'Empty', 0, 0))).toBe(0);
  });

  it('lists the open reports with their episode', () => {
    const data: ShowSegments = {
      show: { id: 1, title: 'Lupin' },
      seasons: [
        {
          seasonNumber: 1,
          episodes: [
            { id: 10, episodeNumber: 1, title: null, duration: 2700, eligible: true, segments: null, reports: [{ id: 5, kind: 'intro', problem: 'starts-early', position: 60, createdAt: 0, user: 'anna' }] },
            { id: 11, episodeNumber: 2, title: null, duration: 2700, eligible: true, segments: null },
          ],
        },
      ],
    };
    const open = openReports(data);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ seasonNumber: 1, report: { id: 5 }, episode: { id: 10 } });
    expect(openReports(undefined)).toEqual([]);
  });
});

describe('detection status', () => {
  const t = (key: string, p?: Record<string, string | number>) => `${key}${p ? JSON.stringify(p) : ''}`;
  const base = { enabled: true, state: 'idle' as const, waitingFor: null, running: null, queuedSeasons: 0, counts: { episodes: 10, analyzed: 10, intros: 8, credits: 9, pending: 0, errors: 0, manual: 0, lowConfidence: 0 } };

  it('says what it does now', () => {
    expect(statusLine(base, t)).toBe('segments.upToDate');
    expect(statusLine({ ...base, counts: { ...base.counts, pending: 3 } }, t)).toBe('segments.pending{"n":3}');
    expect(statusLine({ ...base, enabled: false }, t)).toBe('segments.off');
    expect(statusLine({ ...base, state: 'waiting', waitingFor: 'scan' }, t)).toBe('segments.waitingScan');
    expect(statusLine({ ...base, state: 'running', running: { showId: 1, showTitle: 'Lupin', seasonNumber: 2, done: 1, total: 5 } }, t)).toBe('segments.running{"show":"Lupin","season":2,"done":1,"total":5}');
  });
});
