import { describe, expect, it } from 'vitest';
import { canBlock, diskUsed, formatBytes, optimizationAction, optimizationTitle, requestActions, showsAdminTab, storageMeters, uptime } from './admin';
import { translator } from './i18n';

describe('the Admin tab', () => {
  it('is only there for administrators, and not on a TV', () => {
    expect(showsAdminTab({ role: 'admin' }, false)).toBe(true);
    expect(showsAdminTab({ role: 'user' }, false)).toBe(false);
    expect(showsAdminTab(null, false)).toBe(false);
    expect(showsAdminTab({ role: 'admin' }, true)).toBe(false);
  });

  it('offers approving and declining only for a request that waits for it', () => {
    expect(requestActions('requested')).toEqual(['approve', 'decline', 'cancel']);
    expect(requestActions('approved')).toEqual(['cancel']);
    expect(requestActions('processing')).toEqual(['cancel']);
    expect(requestActions('declined')).toEqual(['cancel']);
    expect(requestActions('available')).toEqual([]);
    expect(requestActions('removed')).toEqual([]);
  });

  it('stops a copy that waits or is being made, and starts one again that stopped', () => {
    expect(optimizationAction('queued')).toBe('stop');
    expect(optimizationAction('processing')).toBe('stop');
    expect(optimizationAction('paused')).toBe('resume');
    expect(optimizationAction('failed')).toBe('resume');
    expect(optimizationAction('stale')).toBe('resume');
    expect(optimizationAction('ready')).toBeNull();
  });

  it('names a copy by its movie or episode', () => {
    expect(optimizationTitle({ title: 'The Matrix', year: 1999, season: null, episode: null })).toBe('The Matrix (1999)');
    expect(optimizationTitle({ title: 'Lupin', year: 2021, season: 4, episode: 5 })).toBe('Lupin · S04E05');
    expect(optimizationTitle({ title: null, year: null, season: null, episode: null })).toBe('—');
  });

  it('never lets administrators block themselves', () => {
    expect(canBlock({ id: 2 }, { id: 1 })).toBe(true);
    expect(canBlock({ id: 1 }, { id: 1 })).toBe(false);
    expect(canBlock({ id: 2 }, null)).toBe(false);
  });

  it('shows sizes, disk use and uptime in short words', () => {
    expect(formatBytes(820_000_000)).toBe('820 MB');
    expect(formatBytes(1_234_000_000)).toBe('1.2 GB');
    expect(formatBytes(512)).toBe('512 B');
    expect(diskUsed({ total: 1000, free: 250, used: 750, level: 'ok' })).toBe(0.75);
    expect(diskUsed(null)).toBeNull();
    expect(uptime(8 * 60)).toBe('8 min');
    expect(uptime(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
    expect(uptime(52 * 3600)).toBe('2 d 4 h');
  });

  it("shows Vidalune's own storage and the disk of the libraries, one bar per disk", () => {
    const disk = (used: number, level: 'ok' | 'low' = 'ok') => ({ total: 1000, free: 1000 - used, used, level });
    const nl = translator('nl');
    expect(storageMeters({ disk: disk(200), mediaDisks: [{ ...disk(900, 'low'), libraries: [{ id: 1, name: 'Films' }, { id: 2, name: 'Series' }] }] }, nl)).toEqual([
      { key: 'vidalune', label: 'Vidalune-opslag', fraction: 0.2, free: 800, warn: false },
      { key: 'library-1', label: 'Bibliotheek: Films, Series', fraction: 0.9, free: 100, warn: true },
    ]);
    // An older server sends no library disks; an unknown size is left out.
    expect(storageMeters({ disk: disk(200) }, translator('en')).map((m) => m.label)).toEqual(['Vidalune storage']);
    expect(storageMeters({ disk: null, mediaDisks: [{ total: 0, free: 0, used: 0, level: 'ok', libraries: [{ id: 3, name: 'X' }] }] }, nl)).toEqual([]);
  });
});
