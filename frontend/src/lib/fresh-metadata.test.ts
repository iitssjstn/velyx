import { describe, expect, it } from 'vitest';
import { askFreshMetadata, type FreshResult } from './fresh-metadata';

function server(answers: FreshResult[]) {
  const urls: string[] = [];
  return {
    urls,
    deps: {
      post: async (url: string) => {
        urls.push(url);
        return answers.shift() ?? { status: 'fresh' as const };
      },
      wait: async () => {},
    },
  };
}

describe('askFreshMetadata', () => {
  it('reports new metadata, and nothing when the stored metadata is still fresh', async () => {
    const a = server([{ status: 'refreshed', id: 7 }]);
    expect(await askFreshMetadata('movie', 7, a.deps)).toBe(7);
    expect(a.urls).toEqual(['/api/movies/7/refresh']);

    expect(await askFreshMetadata('show', 3, server([{ status: 'fresh' }]).deps)).toBeNull();
    expect(await askFreshMetadata('show', 3, server([{ status: 'skipped' }]).deps)).toBeNull();
  });

  it('gives the other item when the movie was merged while refreshing', async () => {
    expect(await askFreshMetadata('movie', 7, server([{ status: 'refreshed', id: 9 }]).deps)).toBe(9);
  });

  it('asks again while the server is busy, and stops after a few tries', async () => {
    const a = server([{ status: 'pending' }, { status: 'pending' }, { status: 'refreshed', id: 3 }]);
    expect(await askFreshMetadata('show', 3, a.deps)).toBe(3);
    expect(a.urls).toEqual(['/api/shows/3/refresh', '/api/shows/3/refresh', '/api/shows/3/refresh']);

    // Done between two questions: the next answer is "fresh", and the page reloads.
    expect(await askFreshMetadata('show', 3, server([{ status: 'pending' }, { status: 'fresh' }]).deps)).toBe(3);
    // Failed in the meantime: nothing to reload.
    expect(await askFreshMetadata('show', 3, server([{ status: 'pending' }, { status: 'skipped' }]).deps)).toBeNull();

    const busy = server(Array.from({ length: 20 }, () => ({ status: 'pending' as const })));
    expect(await askFreshMetadata('movie', 1, busy.deps)).toBeNull();
    expect(busy.urls).toHaveLength(6);
  });

  it('stops asking once the page is closed', async () => {
    const a = server([{ status: 'pending' }, { status: 'pending' }]);
    expect(await askFreshMetadata('movie', 1, { ...a.deps, cancelled: () => true })).toBeNull();
    expect(a.urls).toHaveLength(1);
  });
});
