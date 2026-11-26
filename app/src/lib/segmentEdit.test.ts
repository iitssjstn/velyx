import { describe, expect, it } from 'vitest';
import { buildBody, centralParts, formatTime, initialValues, parseTime, type EditValues } from './segmentEdit';
import type { EpisodeSegments } from './adminPages';

const empty = (): EditValues => ({ recap: { start: '', end: '' }, intro: { start: '', end: '' }, credits: { start: '', end: '' }, postCredits: { start: '', end: '' } });

describe('times', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseTime('83')).toBe(83);
    expect(parseTime(' 1:23 ')).toBe(83);
    expect(parseTime('1:23.5')).toBe(83.5);
    expect(parseTime('1:02:03')).toBe(3723);
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', 'abc', '1:75', '-5', '1:2:3:4', '1,5']) expect(parseTime(bad)).toBeNull();
  });

  it('writes m:ss, h:mm:ss and keeps tenths', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(83.4)).toBe('1:23.4');
    expect(parseTime(formatTime(83.4))).toBeCloseTo(83.4);
  });
});

describe('editing an episode', () => {
  const seg: EpisodeSegments = {
    status: 'analyzed',
    error: null,
    recap: null,
    intro: { start: 30, end: 90, confidence: 'high', source: 'central' },
    credits: { start: 2500, end: 2600, confidence: 'medium', source: 'audio' },
    postCredits: null,
    manual: false,
    detectedAt: 0,
  };

  it('starts with what is stored', () => {
    const v = initialValues(seg);
    expect(v.intro).toEqual({ start: '0:30', end: '1:30' });
    expect(v.recap).toEqual({ start: '', end: '' });
    expect(initialValues(null).credits).toEqual({ start: '', end: '' });
  });

  it('knows which parts come from Vidalune', () => {
    expect(centralParts(seg)).toEqual(['intro']);
    expect(centralParts(null)).toEqual([]);
  });

  it('sends empty pairs as none and times in seconds', () => {
    const v = { ...empty(), intro: { start: '0:30', end: '90' } };
    expect(buildBody(v, 2700)).toEqual({ body: { recap: null, intro: { start: 30, end: 90 }, credits: null, postCredits: null } });
  });

  it('asks for both times', () => {
    expect(buildBody({ ...empty(), credits: { start: '40:00', end: '' } }, null)).toEqual({ problem: { key: 'segmentEdit.enterTimes', part: 'credits' } });
    expect(buildBody({ ...empty(), intro: { start: 'x', end: '1:00' } }, null)).toEqual({ problem: { key: 'segmentEdit.enterTimes', part: 'intro' } });
  });

  it('wants the end after the start', () => {
    expect(buildBody({ ...empty(), intro: { start: '1:30', end: '1:30' } }, null)).toEqual({ problem: { key: 'segmentEdit.endAfterStart', part: 'intro' } });
  });

  it('stays within the episode (one second of slack, like the server)', () => {
    expect(buildBody({ ...empty(), credits: { start: '44:00', end: '45:02' } }, 2700)).toEqual({ problem: { key: 'segmentEdit.afterEpisode', part: 'credits', length: '45:00' } });
    expect('body' in buildBody({ ...empty(), credits: { start: '44:00', end: '45:01' } }, 2700)).toBe(true);
    expect('body' in buildBody({ ...empty(), credits: { start: '44:00', end: '99:00' } }, null)).toBe(true);
  });

  it('keeps the parts in order', () => {
    expect(buildBody({ ...empty(), recap: { start: '0', end: '1:00' }, intro: { start: '0:50', end: '1:30' } }, null)).toEqual({ problem: { key: 'segmentEdit.recapBeforeIntro', part: 'recap' } });
    expect('body' in buildBody({ ...empty(), recap: { start: '0', end: '1:00' }, intro: { start: '0:59', end: '1:30' } }, null)).toBe(true);
    expect(buildBody({ ...empty(), intro: { start: '0', end: '41:00' }, credits: { start: '40:00', end: '44:00' } }, null)).toEqual({ problem: { key: 'segmentEdit.introBeforeCredits', part: 'intro' } });
    expect(buildBody({ ...empty(), credits: { start: '40:00', end: '44:00' }, postCredits: { start: '43:00', end: '44:30' } }, null)).toEqual({ problem: { key: 'segmentEdit.postAfterCredits', part: 'postCredits' } });
  });
});
