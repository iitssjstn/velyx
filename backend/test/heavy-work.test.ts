import { describe, expect, it } from 'vitest';
import { HeavyWork } from '../src/services/heavy-work.js';

describe('whole-file reads per viewer', () => {
  it('runs a few at once per viewer, lets a viewer join their own, and frees a place when one ends', async () => {
    const heavy = new HeavyWork(2);
    let finish!: () => void;
    const long = () => new Promise<void>((resolve) => { finish = resolve; });
    const first = heavy.track(1, 'a', long);
    void heavy.track(1, 'b', () => new Promise<void>(() => undefined));
    expect(() => heavy.track(1, 'c', async () => undefined)).toThrow(/Wait until/);
    // Another viewer has their own places; the same key joins.
    await expect(heavy.track(2, 'c', async () => 'ok')).resolves.toBe('ok');
    void heavy.track(1, 'a', () => new Promise<void>(() => undefined));
    finish();
    await first;
    expect(heavy.count(1)).toBe(2);
  });

  it('frees the place when the work fails', async () => {
    const heavy = new HeavyWork(1);
    await expect(heavy.track(1, 'a', async () => { throw new Error('read failed'); })).rejects.toThrow('read failed');
    expect(heavy.count(1)).toBe(0);
    expect(() => heavy.track(1, 'b', () => { throw new Error('at once'); })).toThrow('at once');
    expect(heavy.count(1)).toBe(0);
  });
});
