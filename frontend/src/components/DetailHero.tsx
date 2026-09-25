import type { ReactNode } from 'react';
import { imageUrl } from '../lib/format';
import { Artwork } from './Artwork';

/**
 * Signature layout for detail pages: a wide backdrop that fades into the page with the poster
 * overlapping its lower edge.
 */
export function DetailHero({ backdropPath, posterPath, title, children }: { backdropPath: string | null; posterPath: string | null; title: string; children: ReactNode }) {
  const src = imageUrl(backdropPath, 'w1280');
  return (
    <section className="relative">
      <div className="absolute inset-x-0 top-0 h-[26rem] overflow-hidden sm:h-[32rem]">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover object-top opacity-60" />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(80%_100%_at_70%_0%,color-mix(in_oklab,var(--color-accent)_25%,transparent),transparent_70%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-transparent to-transparent" />
      </div>
      <div className="relative flex flex-col gap-6 px-4 pt-40 sm:flex-row sm:items-end sm:gap-10 sm:px-8 sm:pt-56">
        <div className="w-36 shrink-0 overflow-hidden rounded-[var(--radius-card)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 sm:w-56">
          <Artwork path={posterPath} size="w342" title={title} eager />
        </div>
        <div className="min-w-0 flex-1 pb-1">{children}</div>
      </div>
    </section>
  );
}

export function MetaList({ items }: { items: Array<ReactNode | null | undefined | false> }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      {list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
