import { useQuery } from '@tanstack/react-query';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { detectCapabilities } from '../lib/codecs';
import { usePrefs } from '../lib/prefs';
import type { PlaybackInfo } from '../lib/types';
import { modeLabel, StreamRows } from './PlaybackDetails';
import { InfoSection } from './MediaInfo';
import { useT } from '../i18n';

const MODE_ICON = { direct: Check, remux: RefreshCw, unsupported: TriangleAlert } as const;
const MODE_CLASS = { direct: 'text-ok', remux: 'text-accent', unsupported: 'text-amber' } as const;

/**
 * How a file will play on this device: Direct Play, Remux (with or without audio conversion) or not
 * at all, and why. Uses the same decision as the player, from the file's stored details.
 */
export function DevicePlayback({ fileId }: { fileId: number }) {
  const { audioOutput, boostVoices, levelVolume } = usePrefs();
  const { t, lang } = useT();
  const q = useQuery({
    queryKey: ['device-playback', fileId, audioOutput, boostVoices, levelVolume, lang],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => api.post<PlaybackInfo>(`/api/media/${fileId}/playback`, { ...detectCapabilities(), audioChannels: audioOutput, boostVoices, levelVolume }),
  });
  return (
    <InfoSection title={t('playback.onThisDevice')} className="sm:col-span-2">
      {q.isLoading ? (
        <p className="text-sm text-muted">{t('playback.checking')}</p>
      ) : q.error || !q.data ? (
        <p className="text-sm text-muted">{t('playback.checkFailed')}</p>
      ) : (
        <PlaybackCheck info={q.data} />
      )}
    </InfoSection>
  );
}

function PlaybackCheck({ info: { analysis: a } }: { info: PlaybackInfo }) {
  const { t } = useT();
  const Icon = MODE_ICON[a.mode];
  return (
    <div>
      <p className={`mb-1 flex items-center gap-2 font-semibold ${MODE_CLASS[a.mode]}`}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {modeLabel(a)}
      </p>
      <div className="mb-4 space-y-0.5 text-sm text-ink/80">
        {a.summary.map((s) => (
          <p key={s}>{s}</p>
        ))}
      </div>
      <StreamRows analysis={a} />
      {(a.device ?? a.browser) && <p className="mt-3 text-xs text-muted">{t('playback.checkedFor', { device: a.device ?? a.browser ?? '' })}</p>}
    </div>
  );
}
