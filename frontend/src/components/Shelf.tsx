import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';

/** A titled horizontal row of cards with scroll buttons on pointer devices. */
export function Shelf({ title, children, moreHref }: { title: string; children: ReactNode; moreHref?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-3 flex items-end justify-between px-4 sm:px-8">
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-[1.4rem]">{title}</h2>
        <div className="flex items-center gap-1">
          {moreHref && (
            <Link to={moreHref} className="mr-2 text-sm text-muted hover:text-ink">
              {t('library.seeAll')}
            </Link>
          )}
          <button type="button" onClick={() => scroll(-1)} className="hidden size-8 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink sm:grid" aria-label={t('library.scrollLeft', { title })}>
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => scroll(1)} className="hidden size-8 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink sm:grid" aria-label={t('library.scrollRight', { title })}>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
      <div ref={ref} className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-px-4 px-4 pt-1 pb-2 sm:scroll-px-8 sm:px-8">
        {children}
      </div>
    </section>
  );
}
