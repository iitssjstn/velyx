import type { Person } from '../lib/types';
import { imageUrl } from '../lib/format';

export function CastRow({ cast }: { cast: Person[] }) {
  if (!cast.length) return null;
  return (
    <section className="mt-12">
      <h2 className="px-4 font-display text-xl font-semibold sm:px-8">Cast</h2>
      <div className="no-scrollbar mt-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-8">
        {cast.map((p) => {
          const src = imageUrl(p.profilePath, 'w185');
          return (
            <div key={`${p.id}-${p.role}`} className="w-28 shrink-0">
              {src ? (
                <img src={src} alt="" loading="lazy" className="aspect-square w-28 rounded-full bg-raised object-cover" />
              ) : (
                <div className="grid aspect-square w-28 place-items-center rounded-full bg-raised font-display text-2xl text-muted" aria-hidden="true">
                  {p.name
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')}
                </div>
              )}
              <p className="mt-2 truncate text-center text-sm font-medium">{p.name}</p>
              {p.role && <p className="truncate text-center text-xs text-faint">{p.role}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
