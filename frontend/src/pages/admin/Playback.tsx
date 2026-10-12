import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { TranscodingSettings } from './TranscodingSettings';

/** Admin → Playback: how files are converted for devices that cannot play them, and subtitles from online. */
export function PlaybackPage() {
  return (
    <div className="space-y-6">
      <TranscodingSettings />
      <OnlineSubtitlesSettings />
    </div>
  );
}

interface OnlineSubtitleSettings {
  via: 'vidalune' | null;
}

/** Subtitles online: through vidalune.com for a server linked to a Vidalune account (nothing to set here). */
export function OnlineSubtitlesSettings() {
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'online-subtitles'], queryFn: () => api.get<OnlineSubtitleSettings>('/api/admin/online-subtitles') });
  if (!q.data) return null;
  return (
    <section className="panel space-y-3 p-5 sm:p-6" aria-labelledby="online-subs-title">
      <h2 id="online-subs-title" className="font-display text-lg font-semibold">{t('server.subtitles.title')}</h2>
      <p className="text-sm text-muted">{t('server.subtitles.text')}</p>
      <p className="text-sm">
        {t('server.status')}{' '}
        {q.data.via === 'vidalune' ? <span className="text-ok">{t('server.subtitles.onVidalune')}</span> : <span className="text-amber">{t('server.subtitles.notLinked')}</span>}
      </p>
      {q.data.via === null && (
        <Link to="/admin/cloud" className="inline-block text-sm text-accent hover:underline">{t('server.subtitles.linkServer')}</Link>
      )}
    </section>
  );
}
