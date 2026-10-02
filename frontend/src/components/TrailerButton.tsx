import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { Modal } from './Modal';

interface Trailer {
  key: string;
  name: string;
}

/**
 * "Trailer" next to Play on a movie or show page, when TMDB knows one. It plays in YouTube's
 * player without cookies, and only once the viewer presses the button (nothing loads before).
 */
export function TrailerButton({ type, id, title }: { type: 'movie' | 'show'; id: number; title: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['trailer', type, id],
    queryFn: () => api.get<{ trailer: Trailer | null }>(`/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/trailer`),
    staleTime: 3_600_000,
    retry: false,
  });
  const trailer = q.data?.trailer;
  if (!trailer) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink/10 px-5 font-medium whitespace-nowrap hover:bg-ink/20">
        <Clapperboard className="size-5" />
        {t('detail.trailer')}
      </button>
      <Modal title={t('detail.trailerOf', { title })} open={open} onClose={() => setOpen(false)} wide>
        {open && (
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
            <iframe
              className="size-full"
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0&modestbranding=1`}
              title={trailer.name || t('detail.trailer')}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}
      </Modal>
    </>
  );
}
