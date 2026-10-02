import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The server's answer (see the backend's FreshMetadata). */
export type FreshResult = { status: 'fresh' | 'pending' | 'skipped' } | { status: 'refreshed'; id: number };

const PENDING_WAIT_MS = 3_000;
const PENDING_TRIES = 5;

/**
 * Asks the server for fresh metadata of a movie or show (it fetches anew when the last refresh is
 * over an hour old). Resolves to the id of the item holding new metadata, or null when nothing changed.
 * While the server is still busy ("pending") it asks again a few times.
 */
export async function askFreshMetadata(
  type: 'movie' | 'show',
  id: number,
  deps: { post: (url: string) => Promise<FreshResult>; wait?: (ms: number) => Promise<void>; cancelled?: () => boolean },
): Promise<number | null> {
  const url = `/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/refresh`;
  const wait = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let r = await deps.post(url);
  let waited = false;
  for (let i = 0; r.status === 'pending' && i < PENDING_TRIES && !deps.cancelled?.(); i++) {
    waited = true;
    await wait(PENDING_WAIT_MS);
    r = await deps.post(url);
  }
  if (r.status === 'refreshed') return r.id;
  // Finished between two questions: the new metadata is there now.
  if (waited && r.status === 'fresh') return id;
  return null;
}

/**
 * A detail page opens with what is stored, then asks for fresh metadata and shows it when it came.
 * `onMoved`: the item was merged into another one while refreshing (rare); its new id.
 */
export function useFreshMetadata(type: 'movie' | 'show', id: number, onMoved?: (id: number) => void): void {
  const qc = useQueryClient();
  const moved = useRef(onMoved);
  moved.current = onMoved;
  useEffect(() => {
    let cancelled = false;
    askFreshMetadata(type, id, { post: (url) => api.post<FreshResult>(url), cancelled: () => cancelled })
      .then((newId) => {
        if (cancelled || newId === null) return;
        if (newId !== id) moved.current?.(newId);
        else void qc.invalidateQueries({ queryKey: [type, id] });
      })
      .catch(() => {
        /* The page keeps what it shows. */
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, qc]);
}
