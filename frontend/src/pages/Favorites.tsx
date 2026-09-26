import { useQuery } from '@tanstack/react-query';
import { Bookmark, Heart } from 'lucide-react';
import { api } from '../lib/api';
import type { Card } from '../lib/types';
import { PosterCard } from '../components/Cards';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { useT, type MessageKey } from '../i18n';

const LISTS = {
  favorites: { title: 'nav.favorites', icon: Heart, empty: 'lists.favoritesEmpty', hint: 'lists.favoritesHint' },
  watchlist: { title: 'nav.watchlist', icon: Bookmark, empty: 'lists.watchlistEmpty', hint: 'lists.watchlistHint' },
} as const satisfies Record<string, { title: MessageKey; icon: typeof Heart; empty: MessageKey; hint: MessageKey }>;

export function SavedListPage({ list }: { list: keyof typeof LISTS }) {
  const meta = LISTS[list];
  const { t } = useT();
  const q = useQuery({ queryKey: [list], queryFn: () => api.get<Card[]>(`/api/${list}`) });
  return (
    <div className="px-4 pt-8 sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t(meta.title)}</h1>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<meta.icon className="size-6" />} title={t(meta.empty)}>
          {t(meta.hint)}
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
