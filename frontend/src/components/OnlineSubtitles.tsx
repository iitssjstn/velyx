import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Download } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { ONLINE_SUBTITLE_LANGUAGES } from '../lib/online-subtitles';
import type { OnlineSubtitleResult, SubtitleOption } from '../lib/types';
import { languageLabel, useT } from '../i18n';
import { Spinner } from './States';
import { toast } from './Toast';

const REMEMBER = 'velyx.onlineSubtitleLanguage';

function rememberedLanguage(): string | null {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
}

/**
 * The "Search online" part of the player's subtitle menu: finds subtitles at OpenSubtitles for this
 * file in the chosen language as soon as the menu opens, and adds the one picked to the player.
 */
export function OnlineSubtitles({ fileId, defaultLanguage, activeKey, onChosen }: { fileId: number; defaultLanguage: string; activeKey: string | null; onChosen: (option: SubtitleOption) => void }) {
  const { t } = useT();
  const [language, setLanguage] = useState(() => {
    const saved = rememberedLanguage();
    return saved && (ONLINE_SUBTITLE_LANGUAGES as readonly string[]).includes(saved) ? saved : defaultLanguage;
  });
  const q = useQuery({
    queryKey: ['online-subtitles', fileId, language],
    queryFn: () => api.get<{ language: string; results: OnlineSubtitleResult[] }>(`/api/media/${fileId}/subtitles/online?language=${encodeURIComponent(language)}`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const fetch = useMutation({
    mutationFn: (r: OnlineSubtitleResult) => api.post<SubtitleOption>(`/api/media/${fileId}/subtitles/online`, { fileId: r.fileId }),
    onSuccess: (option) => {
      onChosen(option);
      toast.success(t('onlineSubs.added'));
      void q.refetch();
    },
    onError: (err) => toast.error(err),
  });
  const choose = (lang: string) => {
    setLanguage(lang);
    try {
      localStorage.setItem(REMEMBER, lang);
    } catch {
      /* not remembered in this browser */
    }
  };
  const names = ONLINE_SUBTITLE_LANGUAGES.map((code) => ({ code, name: languageLabel(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section aria-label={t('onlineSubs.heading')} className="mt-1 border-t border-line/60 pt-2">
      <div className="flex items-center gap-2 px-4 pb-2">
        <p className="flex-1 text-xs text-faint">{t('onlineSubs.heading')}</p>
        <select aria-label={t('onlineSubs.language')} className="max-w-[9.5rem] rounded-md border border-line bg-raised px-1.5 py-1 text-xs" value={language} onChange={(e) => choose(e.target.value)}>
          {names.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
      </div>
      {q.isLoading && (
        <p className="flex items-center gap-2 px-4 py-2 text-sm text-muted" role="status">
          <Spinner className="size-4" /> {t('onlineSubs.searching')}
        </p>
      )}
      {q.error && <p className="px-4 py-2 text-sm text-amber" role="alert">{errorMessage(q.error)}</p>}
      {q.data && q.data.results.length === 0 && <p className="px-4 py-2 text-sm text-muted">{t('onlineSubs.none')}</p>}
      {q.data && q.data.results.length > 0 && (
        <ul aria-label={t('onlineSubs.results')}>
          {q.data.results.slice(0, 12).map((r) => {
            const active = Boolean(r.fetched && r.fetched.key === activeKey);
            const busy = fetch.isPending && fetch.variables?.fileId === r.fileId;
            const facts = [r.hashMatch ? t('onlineSubs.matches') : null, r.hearingImpaired ? t('onlineSubs.hearingImpaired') : null, r.machineTranslated ? t('onlineSubs.machine') : null, t('onlineSubs.downloads', { count: r.downloads })].filter(Boolean).join(' · ');
            return (
              <li key={r.fileId}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={fetch.isPending}
                  onClick={() => (r.fetched ? onChosen(r.fetched) : fetch.mutate(r))}
                  className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm hover:bg-raised disabled:cursor-wait"
                  title={r.release}
                >
                  {busy ? <Spinner className="mt-0.5 size-4 shrink-0" /> : r.fetched ? <Check className={`mt-0.5 size-4 shrink-0 ${active ? 'text-accent' : 'text-faint'}`} /> : <Download className="mt-0.5 size-4 shrink-0 text-faint" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 [overflow-wrap:anywhere]">{r.release || languageLabel(r.language) || r.language}</span>
                    <span className={`block text-xs ${r.hashMatch ? 'text-ok' : 'text-faint'}`}>{facts}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-4 pt-1 text-[0.7rem] text-faint">{t('onlineSubs.source')}</p>
    </section>
  );
}
