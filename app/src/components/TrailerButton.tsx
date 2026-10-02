import { Linking } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../lib/session';
import { trailerUrl, type Trailer } from '../lib/trailer';
import { Button } from './ui';

/** "Trailer" next to Play, when the server knows one; it opens on YouTube. */
export function TrailerButton({ type, id }: { type: 'movie' | 'show'; id: number }) {
  const { api, serverUrl, t } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'trailer', type, id],
    queryFn: () => api.get<{ trailer: Trailer | null }>(`/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/trailer`),
    staleTime: 3_600_000,
    retry: false,
  });
  const url = q.data?.trailer ? trailerUrl(q.data.trailer) : null;
  if (!url) return null;
  return <Button label={t('detail.trailer')} variant="ghost" onPress={() => void Linking.openURL(url)} />;
}
