import { useCallback, useContext, useEffect, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { api } from './api';
import { rememberPreview, type Preview, type PreviewKind } from './preview';

/** How long the pointer rests on a card before its page is fetched (passing over it does nothing). */
export const HOVER_MS = 200;

/**
 * For a card that opens a movie or show: its page is fetched ahead, when the pointer rests on the
 * card and at once when it is pressed or gets keyboard focus, so the page is there when it opens.
 * What the card shows is kept for the page to show meanwhile. Same query as the page itself.
 */
export function useTitlePrefetch(kind: PreviewKind, id: number, preview: Preview) {
  // A card can stand somewhere without loaded data around it: then it only keeps what it shows.
  const qc = useContext(QueryClientContext);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { title, posterPath, backdropPath } = preview;
  const now = useCallback(() => {
    clearTimeout(timer.current);
    rememberPreview(kind, id, { title, posterPath, backdropPath });
    void qc?.prefetchQuery({ queryKey: [kind, id], queryFn: () => api.get(`/api/${kind}s/${id}`) });
  }, [qc, kind, id, title, posterPath, backdropPath]);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(now, HOVER_MS);
  }, [now]);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  return { onPointerEnter: soon, onPointerLeave: cancel, onPointerDown: now, onFocus: now };
}
