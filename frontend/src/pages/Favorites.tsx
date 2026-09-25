import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '../lib/api';
import type { Card } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { EmptyState, ErrorState, PageLoader } from '../components/States';

export function FavoritesPage() {
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => api.get<Card[]>('/api/favorites') });
  return (
    <div className="px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Favorites</h1>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<Heart className="size-6" />} title="No favorites yet">
          Tap the heart on any movie or show to keep it here.
        </EmptyState>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          {q.data.map((item) => (
            <PosterCard key={`${item.type}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
