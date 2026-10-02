import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { askFreshMetadata, type FreshResult } from '../lib/freshMetadata';
import { useSession } from '../lib/session';

/**
 * A detail screen opens with what is stored, then asks for fresh metadata and shows it when it came.
 * `onMoved`: the item was merged into another one while refreshing (rare); its new id.
 */
export function useFreshMetadata(type: 'movie' | 'show', id: string | undefined, onMoved?: (id: number) => void): void {
  const { api, serverUrl } = useSession();
  const qc = useQueryClient();
  const moved = useRef(onMoved);
  moved.current = onMoved;
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    askFreshMetadata(type, id, { post: (path) => api.post<FreshResult>(path), cancelled: () => cancelled })
      .then((newId) => {
        if (cancelled || newId === null) return;
        if (String(newId) !== id) moved.current?.(newId);
        else void qc.invalidateQueries({ queryKey: [serverUrl, type, id] });
      })
      .catch(() => {
        /* The screen keeps what it shows. */
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, api, serverUrl, qc]);
}
