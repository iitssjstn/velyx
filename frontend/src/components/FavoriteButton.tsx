import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from './Toast';

export function FavoriteButton({ type, id, initial, className = '' }: { type: 'movie' | 'show'; id: number; initial: boolean; className?: string }) {
  const qc = useQueryClient();
  const [fav, setFav] = useState(initial);
  const m = useMutation({
    mutationFn: (next: boolean) =>
      next ? api.post('/api/favorites', type === 'movie' ? { movieId: id } : { showId: id }) : api.del(`/api/favorites/${type}/${id}`),
    onMutate: (next) => setFav(next),
    onError: (err, next) => {
      setFav(!next);
      toast.error(err);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['favorites'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: [type, id] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => m.mutate(!fav)}
      aria-pressed={fav}
      aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
      title={fav ? 'Remove from favorites' : 'Add to favorites'}
      className={`grid size-12 place-items-center rounded-full border transition-colors ${
        fav ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-surface/70 text-muted hover:text-ink'
      } ${className}`}
    >
      <Heart className={`size-5 ${fav ? 'fill-current' : ''}`} />
    </button>
  );
}
