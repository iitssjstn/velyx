import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Card } from '../lib/types';
import { PosterCard } from './Cards';
import { Shelf } from './Shelf';

/** "More Like This" row for a detail page; renders nothing when there are no good matches. */
export function MoreLikeThis({ type, id }: { type: 'movie' | 'show'; id: number }) {
  const q = useQuery({
    queryKey: [type, id, 'similar'],
    queryFn: () => api.get<Card[]>(`/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/similar`),
    staleTime: 10 * 60_000,
  });
  if (!q.data?.length) return null;
  return (
    <div className="mt-12">
      <Shelf title="More Like This">
        {q.data.map((c) => (
          <PosterCard key={`${c.type}-${c.id}`} item={c} className="w-36 shrink-0 snap-start sm:w-40" />
        ))}
      </Shelf>
    </div>
  );
}
