import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Heart } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { toast } from './Toast';
import { useT } from '../i18n';

interface SaveButtonProps {
  type: 'movie' | 'show';
  id: number;
  initial: boolean;
  className?: string;
}

/** Round toggle that adds an item to, or removes it from, one of the user's saved lists. */
function SaveToggle({ list, type, id, initial, className = '' }: SaveButtonProps & { list: 'favorites' | 'watchlist' }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [on, setOn] = useState(initial);
  const m = useMutation({
    mutationFn: (next: boolean) =>
      next ? api.post(`/api/${list}`, type === 'movie' ? { movieId: id } : { showId: id }) : api.del(`/api/${list}/${type}/${id}`),
    onMutate: (next) => setOn(next),
    onError: (err, next) => {
      setOn(!next);
      toast.error(err);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [list] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: [type, id] });
    },
  });
  const Icon = list === 'favorites' ? Heart : Bookmark;
  const label = list === 'favorites' ? (on ? t('library.removeFavorite') : t('library.addFavorite')) : on ? t('library.removeWatchlist') : t('library.addWatchlist');
  return (
    <button
      type="button"
      onClick={() => m.mutate(!on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`grid size-12 place-items-center rounded-full border transition-colors ${
        on ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-surface/70 text-muted hover:text-ink'
      } ${className}`}
    >
      <Icon className={`size-5 ${on ? 'fill-current' : ''}`} />
    </button>
  );
}

export function FavoriteButton(props: SaveButtonProps) {
  return <SaveToggle list="favorites" {...props} />;
}

export function WatchlistButton(props: SaveButtonProps) {
  return <SaveToggle list="watchlist" {...props} />;
}
