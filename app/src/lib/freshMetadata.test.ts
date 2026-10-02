import { describe, expect, it } from 'vitest';
import { askFreshMetadata, type FreshResult } from './freshMetadata';

function server(answers: FreshResult[]) {
  const paths: string[] = [];
  return {
    paths,
    deps: {
      post: async (path: string) => {
        paths.push(path);
        return answers.shift() ?? { status: 'fresh' as const };
      },
      wait: async () => {},
    },
  };
}

describe('askFreshMetadata', () => {
  it('reports new metadata, and nothing when the stored metadata is still fresh', async () => {
    const a = server([{ status: 'refreshed', id: 7 }]);
    expect(await askFreshMetadata('movie', '7', a.deps)).toBe(7);
    expect(a.paths).toEqual(['/api/movies/7/refresh']);
    expect(await askFreshMetadata('show', '3', server([{ status: 'fresh' }]).deps)).toBeNull();
    expect(await askFreshMetadata('show', '3', server([{ status: 'skipped' }]).deps)).toBeNull();
    expect(await askFreshMetadata('movie', '7', server([{ status: 'refreshed', id: 9 }]).deps)).toBe(9);
  });

  it('asks again while the server is busy, and stops after a few tries or when the screen closes', async () => {
    const a = server([{ status: 'pending' }, { status: 'refreshed', id: 3 }]);
    expect(await askFreshMetadata('show', '3', a.deps)).toBe(3);
    expect(a.paths).toEqual(['/api/shows/3/refresh', '/api/shows/3/refresh']);
    expect(await askFreshMetadata('show', '3', server([{ status: 'pending' }, { status: 'fresh' }]).deps)).toBe(3);
    const busy = server(Array.from({ length: 20 }, () => ({ status: 'pending' as const })));
    expect(await askFreshMetadata('movie', '1', busy.deps)).toBeNull();
    expect(busy.paths).toHaveLength(6);
    const closed = server([{ status: 'pending' }, { status: 'pending' }]);
    expect(await askFreshMetadata('movie', '1', { ...closed.deps, cancelled: () => true })).toBeNull();
    expect(closed.paths).toHaveLength(1);
  });
});
