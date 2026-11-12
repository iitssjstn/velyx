/**
 * What a card already shows of a title (name, poster, backdrop): kept so the title's own page can
 * show it at once while the rest loads. Only in memory, a few hundred titles at most.
 */
export interface Preview {
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
}

export type PreviewKind = 'movie' | 'show';

const MAX = 400;
const known = new Map<string, Preview>();

export function rememberPreview(kind: PreviewKind, id: number | string, preview: Preview): void {
  const key = `${kind}:${id}`;
  // The newest stay: a title seen again moves to the end.
  known.delete(key);
  known.set(key, { title: preview.title, posterPath: preview.posterPath ?? null, backdropPath: preview.backdropPath ?? null });
  if (known.size > MAX) known.delete(known.keys().next().value!);
}

export function previewOf(kind: PreviewKind, id: number | string): Preview | null {
  return known.get(`${kind}:${id}`) ?? null;
}

/** For tests. */
export function forgetPreviews(): void {
  known.clear();
}

/** How long after a failed poster it is asked again (once). */
export const ARTWORK_RETRY_MS = 1500;
