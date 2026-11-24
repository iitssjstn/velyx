import { describe, expect, it } from 'vitest';
import {
  candidateLine,
  collectionRequest,
  managesTitles,
  manualIds,
  matchRequest,
  matchSearchPath,
  matchedRoute,
  refreshNotice,
  refreshPath,
  yearInput,
} from './adminItem';

describe('admin actions on a title', () => {
  it('are for administrators only', () => {
    expect(managesTitles({ role: 'admin' })).toBe(true);
    expect(managesTitles({ role: 'user' })).toBe(false);
    expect(managesTitles(null)).toBe(false);
  });

  it('search TMDB with the title and a valid year only', () => {
    expect(matchSearchPath('movie', '  The  Matrix ', '1999')).toBe('/api/admin/match/search?type=movie&query=The+Matrix&year=1999');
    expect(matchSearchPath('show', 'Lupin', '')).toBe('/api/admin/match/search?type=show&query=Lupin');
    expect(matchSearchPath('show', 'Lupin', '199')).toBe('/api/admin/match/search?type=show&query=Lupin');
    expect(matchSearchPath('show', 'Lupin', '3000')).toBe('/api/admin/match/search?type=show&query=Lupin');
    expect(matchSearchPath('movie', '   ', '1999')).toBeNull();
    expect(yearInput('19a99x2')).toBe('1999');
  });

  it('send the chosen entry and refresh to the admin API', () => {
    expect(matchRequest('show', 4, 99)).toEqual({ path: '/api/admin/match', body: { type: 'show', id: 4, tmdbId: 99 } });
    expect(refreshPath('movie', 7)).toBe('/api/admin/refresh/movie/7');
    expect(refreshNotice('matched')).toBe('adminItem.refreshed');
    expect(refreshNotice('unmatched')).toBe('adminItem.noMatch');
  });

  it('open the merged movie when it got another id', () => {
    expect(matchedRoute('movie', 3, 3)).toBeNull();
    expect(matchedRoute('movie', 3, 8)).toBe('/movie/8');
    expect(matchedRoute('show', 3, 9)).toBe('/show/9');
  });

  it('put a title in a collection or take it out', () => {
    expect(manualIds([{ id: 1, name: 'Saga', kind: 'auto' }, { id: 2, name: 'Mine', kind: 'manual' }])).toEqual([2]);
    expect(manualIds(undefined)).toEqual([]);
    expect(collectionRequest('movie', 5, 2, true)).toEqual({ method: 'POST', path: '/api/collections/2/items', body: { movieId: 5 } });
    expect(collectionRequest('show', 5, 2, true)).toEqual({ method: 'POST', path: '/api/collections/2/items', body: { showId: 5 } });
    expect(collectionRequest('show', 5, 2, false)).toEqual({ method: 'DELETE', path: '/api/collections/2/items/show/5' });
  });

  it('describe a candidate', () => {
    expect(candidateLine({ title: 'Lupin', originalTitle: 'Lupin', year: 2021, confidence: 0.934 })).toBe('2021 · 93%');
    expect(candidateLine({ title: 'Money Heist', originalTitle: 'La casa de papel', year: null, confidence: 1.2 })).toBe('La casa de papel · 100%');
  });
});
