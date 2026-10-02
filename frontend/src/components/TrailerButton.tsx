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

/** Where the server gives the trailer: an item in the library by its id, any other title by its TMDB id. */
export function trailerPath(type: 'movie' | 'show', id: number, outsideLibrary = false): string {
  if (outsideLibrary) return `/api/seerr/${type === 'movie' ? 'movie' : 'tv'}/${id}/trailer`;
  return `/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/trailer`;
}

/**
 * "Trailer" next to Play on a movie or show page, when TMDB knows one. It plays in YouTube's
 * player without cookies, and only once the viewer presses the button (nothing loads before).
 * `outsideLibrary`: a title that is not in the library (its page from Seerr); `id` is its TMDB id.
 */
export function TrailerButton({ type, id, title, outsideLibrary = false }: { type: 'movie' | 'show'; id: number; title: string; outsideLibrary?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const path = trailerPath(type, id, outsideLibrary);
  const q = useQuery({
    queryKey: ['trailer', path],
    queryFn: () => api.get<{ trailer: Trailer | null }>(path),
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
