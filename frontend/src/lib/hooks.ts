import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The value, but only after it stopped changing for `ms` (typing → one request, not one per key). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * For a pop-up menu: when it opens, shifts it sideways just enough to keep it on screen (a button
 * near the edge of a phone screen would otherwise open a menu that is partly cut off).
 */
export function useKeepOnScreen<T extends HTMLElement>(open: boolean, margin = 8) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
    if (r.left + dx < margin) dx = margin - r.left;
    if (dx) el.style.translate = `${Math.round(dx)}px 0`;
  }, [open, margin]);
  return ref;
}
