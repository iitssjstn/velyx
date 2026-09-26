import type { Person } from '../lib/types';
import { imageUrl } from '../lib/format';
import { useT } from '../i18n';
import { Shelf } from './Shelf';

export function CastRow({ cast }: { cast: Person[] }) {
  const { t } = useT();
  if (!cast.length) return null;
  return (
    // A shelf like the ones on Home: with scroll buttons, since the row has no visible scroll bar.
    <div className="mt-12">
      <Shelf title={t('library.cast')}>
        {cast.map((p) => {
          const src = imageUrl(p.profilePath, 'w185');
          return (
            <div key={`${p.id}-${p.role}`} className="w-28 shrink-0 snap-start">
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
      </Shelf>
    </div>
  );
}
