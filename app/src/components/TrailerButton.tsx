import { Linking } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../lib/session';
import { trailerPath, trailerUrl, type Trailer } from '../lib/trailer';
import { Button } from './ui';

/**
 * "Trailer" next to Play, when the server knows one; it opens on YouTube. `outsideLibrary`: a title
 * that is not in the library (its page from the catalog); `id` is its TMDB id.
 */
export function TrailerButton({ type, id, outsideLibrary = false }: { type: 'movie' | 'show'; id: number; outsideLibrary?: boolean }) {
  const { api, serverUrl, t } = useSession();
  const path = trailerPath(type, id, outsideLibrary);
  const q = useQuery({
    queryKey: [serverUrl, 'trailer', path],
    queryFn: () => api.get<{ trailer: Trailer | null }>(path),
    staleTime: 3_600_000,
    retry: false,
  });
  const url = q.data?.trailer ? trailerUrl(q.data.trailer) : null;
  if (!url) return null;
  return <Button label={t('detail.trailer')} variant="ghost" onPress={() => void Linking.openURL(url)} />;
}
