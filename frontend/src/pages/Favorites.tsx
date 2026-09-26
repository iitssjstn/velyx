import { useQuery } from '@tanstack/react-query';
import { Bookmark, Heart } from 'lucide-react';
import { api } from '../lib/api';
import type { Card } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { EmptyState, ErrorState, PageLoader } from '../components/States';

const LISTS = {
  favorites: {
    title: 'Favorites',
    icon: Heart,
    empty: 'No favorites yet',
    hint: 'Tap the heart on any movie or show to keep it here.',
  },
  watchlist: {
    title: 'Watchlist',
    icon: Bookmark,
    empty: 'Your watchlist is empty',
    hint: 'Tap the bookmark on any movie or show you want to watch later. Movies leave the list once you have watched them.',
  },
} as const;

export function SavedListPage({ list }: { list: keyof typeof LISTS }) {
  const meta = LISTS[list];
  const q = useQuery({ queryKey: [list], queryFn: () => api.get<Card[]>(`/api/${list}`) });
  return (
    <div className="px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{meta.title}</h1>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<meta.icon className="size-6" />} title={meta.empty}>
          {meta.hint}
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

export function FavoritesPage() {
  return <SavedListPage list="favorites" />;
}

export function WatchlistPage() {
  return <SavedListPage list="watchlist" />;
}
