import { describe, expect, it } from 'vitest';
import {
  defaultFolder,
  foldersPath,
  formProblem,
  healthListPath,
  healthPages,
  healthSummaryPath,
  healthTarget,
  insideLibrary,
  isMediaRoot,
  libraryId,
  libraryState,
  needsAttention,
  notAnalyzed,
  phaseKey,
  pickerStart,
  playbackShares,
  playbackTone,
  saveRequest,
  scanBody,
  scanFraction,
  scanSummary,
  intervalChoices,
  intervalText,
  scanChanges,
  scanForm,
  type HealthCategory,
} from './adminLibraries';
import { translator } from './i18n';

const form = { name: ' Films ', type: 'movies' as const, path: ' /media/movies ' };

describe('library form', () => {
  it('starts inside the first media root and warns for a whole root', () => {
    expect(defaultFolder(['/media/'])).toBe('/media/');
    expect(defaultFolder([])).toBe('');
    expect(isMediaRoot('/media/', ['/media'])).toBe(true);
    expect(isMediaRoot('/media/movies', ['/media'])).toBe(false);
    expect(isMediaRoot('  ', ['/media'])).toBe(false);
  });

  it('asks for a name and a folder before saving', () => {
    expect(formProblem(form)).toBeNull();
    expect(formProblem({ ...form, name: '  ' })).toBe('libraries.nameNeeded');
    expect(formProblem({ ...form, name: 'x'.repeat(65) })).toBe('libraries.nameTooLong');
    expect(formProblem({ ...form, path: '' })).toBe('libraries.folderNeeded');
  });

  it('adds with the type, edits only name and folder', () => {
    expect(saveRequest(form, null)).toEqual({ method: 'post', path: '/api/libraries', body: { name: 'Films', type: 'movies', path: '/media/movies' } });
    expect(saveRequest(form, 4)).toEqual({ method: 'put', path: '/api/libraries/4', body: { name: 'Films', path: '/media/movies' } });
  });

  it('reads the id from the route', () => {
    expect(libraryId('3')).toBe(3);
    expect(libraryId(['7'])).toBe(7);
    expect(libraryId(undefined)).toBeNull();
    expect(libraryId('abc')).toBeNull();
    expect(libraryId('0')).toBeNull();
  });

  it('browses the server folders', () => {
    expect(foldersPath(null)).toBe('/api/libraries/folders');
    expect(foldersPath('/media/my films')).toBe('/api/libraries/folders?path=%2Fmedia%2Fmy%20films');
    expect(pickerStart('/media/movies//')).toBe('/media/movies');
    expect(pickerStart(' ')).toBeNull();
  });
});

describe('library list', () => {
  const base = { scanning: null, queued: false, lastScanStatus: 'ok' as const, lastScanAt: 1 };

  it('says what the library is doing, in the website order', () => {
    expect(libraryState({ ...base, scanning: { phase: 'analyzing', processed: 1, total: 4 }, queued: true })).toBe('scanning');
    expect(libraryState({ ...base, queued: true, lastScanStatus: 'empty' })).toBe('queued');
    expect(libraryState({ ...base, lastScanStatus: 'empty' })).toBe('empty');
    expect(libraryState({ ...base, lastScanStatus: 'error' })).toBe('error');
    expect(libraryState(base)).toBe('ok');
    expect(libraryState({ ...base, lastScanAt: null, lastScanStatus: null })).toBe('never');
  });

  it('sends the right scan', () => {
    expect(scanBody('new')).toEqual({});
    expect(scanBody('metadata')).toEqual({ refreshMetadata: true });
    expect(scanBody('full')).toEqual({ full: true });
    expect(scanBody('confirmEmpty')).toEqual({ confirmEmpty: true });
  });

  it('shows progress and phase', () => {
    expect(scanFraction({ scanning: { phase: 'x', processed: 1, total: 4 } })).toBe(0.25);
    expect(scanFraction({ scanning: { phase: 'x', processed: 0, total: 0 } })).toBeNull();
    expect(scanFraction({ scanning: null })).toBeNull();
    expect(phaseKey('metadata')).toBe('libraries.phase.metadata');
    expect(phaseKey('other')).toBe('libraries.phase.scanning');
  });

  it('translates the scan summary and keeps unknown parts', () => {
    expect(scanSummary('120 files, 3 added, 2 need review, odd', translator('nl'))).toBe('120 bestanden, 3 toegevoegd, 2 na te kijken, odd');
  });

  it('shows file paths inside the library', () => {
    expect(insideLibrary('/media/tv/Show/a.mkv', '/media/tv/')).toBe('Show/a.mkv');
    expect(insideLibrary('/media/tvx/a.mkv', '/media/tv')).toBe('/media/tvx/a.mkv');
  });
});

describe('library health', () => {
  const cat = (key: string, group: HealthCategory['group'], count: number): HealthCategory => ({ key, group, count, label: key, unit: 'files', description: '' });

  it('builds the paths', () => {
    expect(healthSummaryPath(null)).toBe('/api/admin/health');
    expect(healthSummaryPath(2)).toBe('/api/admin/health?libraryId=2');
    expect(healthListPath('scan-errors', 3, null)).toBe('/api/admin/health/scan-errors?page=3&limit=50');
    expect(healthListPath('remux', 1, 5)).toBe('/api/admin/health/remux?page=1&limit=50&libraryId=5');
    expect(healthPages(0)).toBe(1);
    expect(healthPages(101)).toBe(3);
  });

  it('marks problems and colours playback', () => {
    expect(needsAttention(cat('duplicates', 'library', 2))).toBe(true);
    expect(needsAttention(cat('duplicates', 'library', 0))).toBe(false);
    expect(needsAttention(cat('hevc', 'formats', 9))).toBe(false);
    expect(playbackTone('direct')).toBe('ok');
    expect(playbackTone('unsupported')).toBe('danger');
    expect(playbackTone('hevc')).toBeNull();
  });

  it('splits the playback bar and counts files not analysed', () => {
    const cats = [cat('direct', 'playback', 3), cat('remux', 'playback', 1), cat('unsupported', 'playback', 0), cat('not-analyzed', 'formats', 7)];
    expect(playbackShares(cats, 4)).toEqual([
      { key: 'direct', share: 0.75 },
      { key: 'remux', share: 0.25 },
    ]);
    expect(playbackShares(cats, 0)).toEqual([]);
    expect(notAnalyzed(cats)).toBe(7);
    expect(notAnalyzed([])).toBe(0);
  });

  it('opens the app screen for a website link', () => {
    expect(healthTarget('/movies/12')).toBe('/movie/12');
    expect(healthTarget('/shows/4')).toBe('/show/4');
    expect(healthTarget('/admin/libraries')).toBeNull();
  });
});

describe('scan settings', () => {
  const saved = { scanIntervalMinutes: 360, scanIntervalSource: 'environment' as const, scanIntervalDefault: 360, watchFolders: true, scanOnStartup: false, deferScansWhilePlaying: true };

  it('shows the environment default as empty and a saved interval as itself', () => {
    expect(scanForm(saved).interval).toBe('');
    expect(scanForm({ ...saved, scanIntervalSource: 'settings', scanIntervalMinutes: 45 }).interval).toBe('45');
    expect(intervalChoices('')).toEqual(['', '0', '60', '180', '360', '720', '1440']);
    expect(intervalChoices('45').at(-1)).toBe('45');
    expect(intervalChoices('60')).toHaveLength(7);
  });

  it('names intervals', () => {
    expect(intervalText(0)).toEqual({ key: 'libraries.interval.off', n: 0 });
    expect(intervalText(2880)).toEqual({ key: 'libraries.interval.days', n: 2 });
    expect(intervalText(180)).toEqual({ key: 'libraries.interval.hours', n: 3 });
    expect(intervalText(45)).toEqual({ key: 'libraries.interval.minutes', n: 45 });
  });

  it('sends only the fields of the panel that changed', () => {
    const form = scanForm(saved);
    expect(scanChanges(form, form)).toEqual({});
    expect(scanChanges(form, { ...form, interval: '60', scanOnStartup: true })).toEqual({ scanIntervalMinutes: 60, scanOnStartup: true });
    expect(scanChanges({ ...form, interval: '60' }, form)).toEqual({ scanIntervalMinutes: null });
  });
});
