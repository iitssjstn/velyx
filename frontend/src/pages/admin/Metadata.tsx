import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { ReviewItem } from '../../lib/types';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { FixMatchModal } from '../../components/FixMatchModal';

export function MetadataPage() {
  const q = useQuery({ queryKey: ['admin', 'review'], queryFn: () => api.get<{ tmdbConfigured: boolean; movies: ReviewItem[]; shows: ReviewItem[] }>('/api/admin/review') });
  const [fixing, setFixing] = useState<ReviewItem | null>(null);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = [...q.data.movies, ...q.data.shows];

  if (!q.data.tmdbConfigured) {
    return (
      <EmptyState icon={<Wand2 className="size-6" />} title="TMDB is not configured" action={<Link to="/admin/server" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">Add a TMDB key</Link>}>
        Without a TMDB API key Velyx uses the names from your files. Add a key to fetch posters, descriptions and cast.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Items Velyx could not match with enough confidence, or that are still waiting for metadata. Pick the right title with Fix match. You can also fix any item from its detail page.
      </p>
      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-6" />} title="Everything is matched">
          New items that need attention will show up here after a scan.
        </EmptyState>
      ) : (
        <ul className="panel divide-y divide-line/60">
          {items.map((it) => (
            <li key={`${it.type}-${it.id}`} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/${it.type === 'movie' ? 'movies' : 'shows'}/${it.id}`} className="font-medium hover:text-accent">
                  {it.title}
                </Link>
                <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-xs text-muted">{it.type === 'movie' ? 'Movie' : 'Show'}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${it.status === 'pending' ? 'bg-raised text-muted' : 'bg-amber/15 text-amber'}`}>
                  {it.status === 'pending' ? 'Waiting' : `Best guess ${Math.round((it.confidence ?? 0) * 100)}%`}
                </span>
                {it.samplePath && <p className="mt-1 truncate font-mono text-xs text-faint">{it.samplePath}</p>}
              </div>
              <Button variant="secondary" size="sm" icon={<Wand2 className="size-4" />} onClick={() => setFixing(it)}>
                Fix match
              </Button>
            </li>
          ))}
        </ul>
      )}
      {fixing && (
        <FixMatchModal open onClose={() => setFixing(null)} type={fixing.type} id={fixing.id} initialQuery={fixing.parsedTitle} initialYear={fixing.parsedYear} onMatched={() => void q.refetch()} />
      )}
    </div>
  );
}
