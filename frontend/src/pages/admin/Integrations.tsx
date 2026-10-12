import { useT } from '../../i18n';
import { SeerrSettings } from './SeerrSettings';
import { ArrSettingsPage } from './ArrSettings';

/** Admin → Integrations: the optional services Vidalune can work with (Seerr for requests, Sonarr and Radarr). */
export function IntegrationsPage() {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{t('admin.integrationsIntro')}</p>
      <SeerrSettings />
      <ArrSettingsPage />
    </div>
  );
}
