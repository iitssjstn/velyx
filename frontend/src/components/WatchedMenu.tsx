import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Eye, EyeOff } from 'lucide-react';
import { useT } from '../i18n';

/**
 * Round "watched" button for a whole series: opens a menu with "Mark as watched" and
 * "Mark as unwatched", each offered whenever it would change something.
 */
export function WatchedMenu({ watchedCount, total, onMark }: { watchedCount: number; total: number; onMark: (watched: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const all = total > 0 && watchedCount >= total;
  const item = 'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-line disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('library.seriesWatchedStatus')}
        title={t('library.watchedOf', { watched: watchedCount, total })}
        className={`grid size-12 place-items-center rounded-full border transition-colors ${all ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-surface/70 text-muted hover:text-ink'}`}
      >
        {all ? <CheckCheck className="size-5" /> : <Eye className="size-5" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-2xl sm:right-auto sm:left-0">
          <button type="button" role="menuitem" className={item} disabled={all} onClick={() => (setOpen(false), onMark(true))}>
            <CheckCheck className="size-4 text-muted" /> {t('library.markSeriesWatched')}
          </button>
          <button type="button" role="menuitem" className={item} disabled={watchedCount === 0} onClick={() => (setOpen(false), onMark(false))}>
            <EyeOff className="size-4 text-muted" /> {t('library.markSeriesUnwatched')}
          </button>
        </div>
      )}
    </div>
  );
}
