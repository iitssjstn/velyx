import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface GridLayout {
  columns: number;
  columnWidth: number;
  rowHeight: number;
}

/** Column count and sizes for a container width, matching the old CSS auto-fill grid. */
export function gridLayout(width: number, minColumnWidth: number, gapX: number, rowHeightFor: (columnWidth: number) => number): GridLayout {
  const columns = Math.max(1, Math.floor((width + gapX) / (minColumnWidth + gapX)));
  const columnWidth = Math.max(0, (width - gapX * (columns - 1)) / columns);
  return { columns, columnWidth, rowHeight: rowHeightFor(columnWidth) };
}

/**
 * The rows to render for a scroll position: everything intersecting the viewport plus `overscan`
 * rows on each side. `offsetTop` is the grid's distance from the top of the scrolling page.
 */
export function visibleRows(
  { scrollY, viewportHeight, offsetTop }: { scrollY: number; viewportHeight: number; offsetTop: number },
  rowStride: number,
  rowCount: number,
  overscan = 2,
): { first: number; last: number } {
  if (rowCount === 0 || rowStride <= 0) return { first: 0, last: -1 };
  const top = scrollY - offsetTop;
  const first = Math.max(0, Math.floor(top / rowStride) - overscan);
  const last = Math.min(rowCount - 1, Math.floor((top + viewportHeight) / rowStride) + overscan);
  return { first, last: Math.max(first - 1, last) };
}

/**
 * A poster grid that only puts the visible rows in the DOM, so a library of thousands of titles
 * scrolls smoothly on modest devices. Scrolls with the page (no inner scroll container).
 * `onNearEnd` fires when the last rendered row is within a few rows of the end (load the next page).
 */
export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  minColumnWidth,
  gapX = 16,
  gapY = 24,
  rowHeightFor,
  onNearEnd,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T) => ReactNode;
  minColumnWidth: number | (() => number);
  gapX?: number;
  gapY?: number;
  /** Height of one row for a given column width (poster 2:3 plus the title lines). */
  rowHeightFor: (columnWidth: number) => number;
  onNearEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ first: 0, last: 5 });
  const minWidth = typeof minColumnWidth === 'function' ? minColumnWidth() : minColumnWidth;
  const layout = gridLayout(width, minWidth, gapX, rowHeightFor);
  const rowCount = Math.ceil(items.length / layout.columns);
  const stride = layout.rowHeight + gapY;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const offsetTop = el.getBoundingClientRect().top + window.scrollY;
      const next = visibleRows({ scrollY: window.scrollY, viewportHeight: window.innerHeight, offsetTop }, stride, rowCount);
      setRange((r) => (r.first === next.first && r.last === next.last ? r : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stride, rowCount]);

  useEffect(() => {
    if (onNearEnd && rowCount > 0 && range.last >= rowCount - 3) onNearEnd();
  }, [range.last, rowCount, onNearEnd]);

  const rows: ReactNode[] = [];
  for (let r = range.first; r <= range.last; r++) {
    const slice = items.slice(r * layout.columns, (r + 1) * layout.columns);
    rows.push(
      <div
        key={r}
        role="row"
        className="absolute inset-x-0 grid"
        style={{ top: r * stride, gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, columnGap: gapX }}
      >
        {slice.map((item) => (
          <div key={getKey(item)} role="gridcell">
            {renderItem(item)}
          </div>
        ))}
      </div>,
    );
  }

  return (
    <div ref={ref} role="grid" aria-rowcount={rowCount} className="relative" style={{ height: rowCount ? rowCount * stride - gapY : 0 }}>
      {width > 0 && rows}
    </div>
  );
}
