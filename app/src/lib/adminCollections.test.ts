import { describe, expect, it } from 'vitest';
import {
  addItemBody,
  adminLists,
  collectionBody,
  collectionKeys,
  EMPTY_SMART,
  editHref,
  filterLines,
  inCollection,
  paramId,
  removeItemPath,
  searchPath,
  smartBody,
  smartProblem,
  smartQuery,
  sortKey,
  SORTS,
  watchFilters,
  withKind,
} from './adminCollections';
import type { CollectionSummary, SmartCollection } from './collections';
import { MESSAGES } from './i18n';

describe('smart collection filters', () => {
  it('stores only what is set', () => {
    expect(smartQuery(EMPTY_SMART)).toEqual({});
    expect(smartQuery({ ...EMPTY_SMART, filter: 'unwatched', genre: '28', resolution: '4k', hdr: true, yearFrom: ' 1990', yearTo: '1999', minRating: '7', maxRuntime: '095', sort: 'rating' })).toEqual({
      filter: 'unwatched',
      genre: '28',
      resolution: '4k',
      hdr: '1',
      yearFrom: '1990',
      yearTo: '1999',
      minRating: '7',
      maxRuntime: '95',
      sort: 'rating',
    });
  });

  it('leaves out movie-only filters for shows', () => {
    expect(smartQuery({ ...EMPTY_SMART, kind: 'shows', resolution: '4k', hdr: true, maxRuntime: '90' })).toEqual({});
  });

  it('switches kind and keeps what still applies', () => {
    const d = withKind({ ...EMPTY_SMART, filter: 'watched', genre: '28', resolution: '4k', hdr: true, maxRuntime: '90', sort: 'runtime', minRating: '7' }, 'shows');
    expect(d).toMatchObject({ kind: 'shows', filter: 'completed', genre: '', resolution: '', hdr: false, maxRuntime: '', sort: 'title', minRating: '7' });
    expect(withKind(d, 'movies').filter).toBe('watched');
    expect(withKind(d, 'shows')).toBe(d);
  });

  it('checks name, years and runtime', () => {
    expect(smartProblem(' ', EMPTY_SMART)).toBe('adminCollections.nameNeeded');
    expect(smartProblem('A', EMPTY_SMART)).toBeNull();
    expect(smartProblem('A', { ...EMPTY_SMART, yearFrom: '1800' })).toBe('adminCollections.badYear');
    expect(smartProblem('A', { ...EMPTY_SMART, yearFrom: '19a0' })).toBe('adminCollections.badYear');
    expect(smartProblem('A', { ...EMPTY_SMART, yearFrom: '2000', yearTo: '1990' })).toBe('adminCollections.badYear');
    expect(smartProblem('A', { ...EMPTY_SMART, maxRuntime: '0' })).toBe('adminCollections.badRuntime');
    expect(smartProblem('A', { ...EMPTY_SMART, kind: 'shows', maxRuntime: '0' })).toBeNull();
  });

  it('builds the request body', () => {
    expect(smartBody('  Nineties ', { ...EMPTY_SMART, yearFrom: '1990' })).toEqual({ name: 'Nineties', kind: 'movies', query: { yearFrom: '1990' } });
  });

  it('names watched "completed" for shows', () => {
    expect(watchFilters('movies').map((f) => f.value)).toContain('watched');
    expect(watchFilters('shows').map((f) => f.value)).toContain('completed');
  });

  it('describes the filters in words', () => {
    const lines = filterLines({ kind: 'movies', query: { filter: 'unwatched', genre: '28', resolution: '1080p', hdr: '1', yearFrom: '1990', yearTo: '1999', minRating: '7', maxRuntime: '95', sort: 'added' } }, (id) => (id === '28' ? 'Action' : undefined));
    expect(lines).toEqual([
      { key: 'adminCollections.filter.unwatched' },
      { key: 'adminCollections.line.genre', params: { name: 'Action' } },
      { key: 'adminCollections.line.quality', params: { value: '1080p' } },
      { key: 'adminCollections.line.hdr' },
      { key: 'adminCollections.line.years', params: { from: '1990', to: '1999' } },
      { key: 'adminCollections.line.rating', params: { rating: '7' } },
      { key: 'adminCollections.line.runtime', params: { n: '95' } },
      { key: 'adminCollections.sortBy.added' },
    ]);
    expect(filterLines({ kind: 'shows', query: { yearTo: '2000', genre: '5' } })).toEqual([
      { key: 'adminCollections.line.genre', params: { name: '#5' } },
      { key: 'adminCollections.line.untilYear', params: { year: '2000' } },
    ]);
    expect(filterLines({ kind: 'movies', query: { resolution: '4k', yearFrom: '2010' } })[0]?.params).toEqual({ value: '4K' });
  });
});

describe('collections', () => {
  const c = (id: number, kind: 'auto' | 'manual'): CollectionSummary => ({ id, kind, name: `C${id}`, overview: null, posterPath: null, backdropPath: null, itemCount: 0 });
  const s = (key: string, id: number | null, custom: boolean): SmartCollection => ({ key, id, custom, name: key, kind: 'movies', query: {}, count: 0, posterPath: null });

  it('splits what an admin can change from the movie series and built-in filters', () => {
    const lists = adminLists([c(1, 'auto'), c(2, 'manual')], [s('4k', null, false), s('custom-9', 9, true)]);
    expect(lists.manual.map((x) => x.id)).toEqual([2]);
    expect(lists.auto.map((x) => x.id)).toEqual([1]);
    expect(lists.smart.map((x) => x.id)).toEqual([9]);
  });

  it('trims the name and drops an empty description', () => {
    expect(collectionBody(' Xmas ', '  ')).toEqual({ name: 'Xmas', overview: null });
    expect(collectionBody('Xmas', ' Cosy ')).toEqual({ name: 'Xmas', overview: 'Cosy' });
  });

  it('adds and removes titles', () => {
    expect(addItemBody({ type: 'movie', id: 3 })).toEqual({ movieId: 3 });
    expect(addItemBody({ type: 'show', id: 4 })).toEqual({ showId: 4 });
    expect(removeItemPath(7, { type: 'show', id: 4 })).toBe('/api/collections/7/items/show/4');
    expect(inCollection([{ type: 'movie', id: 4 }], { type: 'show', id: 4 })).toBe(false);
    expect(inCollection([{ type: 'show', id: 4 }], { type: 'show', id: 4 })).toBe(true);
  });

  it('searches from two letters', () => {
    expect(searchPath(' a ')).toBeNull();
    expect(searchPath(' die hard ')).toBe('/api/search?q=die%20hard');
  });

  it('links to the edit screen and reads its id', () => {
    expect(editHref(null)).toBe('/admin/collection');
    expect(editHref(null, true)).toBe('/admin/collection?smart=1');
    expect(editHref({ id: 3 })).toBe('/admin/collection?id=3');
    expect(editHref({ id: 3, smart: true })).toBe('/admin/collection?id=3&smart=1');
    expect(paramId('3')).toBe(3);
    expect(paramId(['5'])).toBe(5);
    expect(paramId(undefined)).toBeNull();
    expect(paramId('0')).toBeNull();
    expect(paramId('x')).toBeNull();
  });

  it('refreshes the viewer screens of this server', () => {
    expect(collectionKeys('https://s')).toEqual([['https://s', 'collections'], ['https://s', 'collection'], ['https://s', 'movie'], ['https://s', 'show']]);
  });

  it('has every text in both languages', () => {
    const keys = [...SORTS.map(sortKey), ...watchFilters('movies').map((f) => f.key), ...watchFilters('shows').map((f) => f.key)];
    for (const k of keys) {
      expect(MESSAGES.en[k]).toBeTruthy();
      expect(MESSAGES.nl[k]).toBeTruthy();
    }
  });
});
