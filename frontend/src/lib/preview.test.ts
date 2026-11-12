import { beforeEach, describe, expect, it } from 'vitest';
import { forgetPreviews, previewOf, rememberPreview } from './preview';

beforeEach(() => forgetPreviews());

describe('what a card already shows of a title', () => {
  it('is kept per kind and id', () => {
    rememberPreview('movie', 7, { title: 'Interstellar', posterPath: '/p.jpg', backdropPath: null });
    expect(previewOf('movie', 7)).toEqual({ title: 'Interstellar', posterPath: '/p.jpg', backdropPath: null });
    expect(previewOf('show', 7)).toBeNull();
    expect(previewOf('movie', 8)).toBeNull();
  });

  it('keeps only the newest few hundred', () => {
    for (let id = 1; id <= 450; id++) rememberPreview('movie', id, { title: `Film ${id}`, posterPath: null, backdropPath: null });
    expect(previewOf('movie', 1)).toBeNull();
    expect(previewOf('movie', 450)?.title).toBe('Film 450');
  });
});
