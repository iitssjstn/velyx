import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ServerSettings } from '../../lib/types';
import { toast } from '../../components/Toast';
import { useT } from '../../i18n';

/**
 * The server's settings, shared by every admin page that shows a part of them. Each page saves only its own
 * fields; the server keeps the rest as they are.
 */
export function useServerSettings() {
  const qc = useQueryClient();
  const { refetchServer } = useAuth();
  const { t } = useT();
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<ServerSettings>('/api/admin/settings') });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ServerSettings>('/api/admin/settings', body),
    onSuccess: (data, body) => {
      qc.setQueryData(['admin', 'settings'], data);
      refetchServer();
      if ('tmdbApiKey' in body) {
        // A new or removed TMDB key changes what the Metadata page can show.
        void qc.invalidateQueries({ queryKey: ['admin', 'review'] });
        toast.success(body.tmdbApiKey ? t('server.keySaved') : t('server.keyRemoved'));
      } else toast.success(t('server.saved'));
    },
    onError: (err) => toast.error(err),
  });
  return { query, save };
}
