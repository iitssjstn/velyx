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
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data);
      refetchServer();
      toast.success(t('server.saved'));
    },
    onError: (err) => toast.error(err),
  });
  return { query, save };
}
