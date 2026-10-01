import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { errorMessage } from '../lib/connection';
import { ONLINE_SUBTITLE_LANGUAGES, languageName, type OnlineSubtitleResult } from '../lib/onlineSubtitles';
import type { SubtitleOption } from '../lib/playback';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { styles } from './ui';

/**
 * "Search online" in the player's menu: subtitles at OpenSubtitles for this file in the chosen
 * language (through the server, which may search through vidalune.com), added with a tap.
 */
export function OnlineSubtitles({ fileId, defaultLanguage, activeKey, onChosen }: { fileId: number; defaultLanguage: string; activeKey: string | null; onChosen: (option: SubtitleOption) => void }) {
  const { api, t, serverUrl, language: appLanguage } = useSession();
  const [language, setLanguage] = useState(defaultLanguage);
  const [picking, setPicking] = useState(false);
  const q = useQuery({
    queryKey: [serverUrl, 'online-subtitles', fileId, language],
    queryFn: () => api.get<{ language: string; results: OnlineSubtitleResult[] }>(`/api/media/${fileId}/subtitles/online?language=${encodeURIComponent(language)}`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const fetch = useMutation({
    mutationFn: (r: OnlineSubtitleResult) => api.post<SubtitleOption>(`/api/media/${fileId}/subtitles/online`, { fileId: r.fileId }),
    onSuccess: (option) => {
      onChosen(option);
      void q.refetch();
    },
  });
  const names = ONLINE_SUBTITLE_LANGUAGES.map((code) => ({ code, name: languageName(code, appLanguage) })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('onlineSubs.heading')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onlineSubs.language')}
        onPress={() => setPicking((p) => !p)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.raised }}
      >
        <Feather name="globe" size={16} color={colors.muted} />
        <Text style={{ color: colors.ink, flex: 1 }}>{languageName(language, appLanguage)}</Text>
        <Feather name={picking ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </Pressable>
      {picking && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {names.map((l) => (
            <Pressable
              key={l.code}
              accessibilityRole="radio"
              accessibilityState={{ selected: l.code === language }}
              onPress={() => {
                setLanguage(l.code);
                setPicking(false);
              }}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: l.code === language ? colors.accent : colors.raised }}
            >
              <Text style={{ color: l.code === language ? colors.bg : colors.ink, fontSize: 13 }}>{l.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {q.isLoading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
          <ActivityIndicator color={colors.muted} size="small" />
          <Text style={{ color: colors.muted }}>{t('onlineSubs.searching')}</Text>
        </View>
      )}
      {q.error ? <Text style={{ color: colors.danger, padding: 8 }}>{errorMessage(q.error, t)}</Text> : null}
      {fetch.error ? <Text style={{ color: colors.danger, padding: 8 }}>{errorMessage(fetch.error, t)}</Text> : null}
      {q.data && q.data.results.length === 0 && <Text style={{ color: colors.muted, padding: 8 }}>{t('onlineSubs.none')}</Text>}
      {(q.data?.results ?? []).slice(0, 12).map((r) => {
        const active = !!r.fetched && r.fetched.key === activeKey;
        const busy = fetch.isPending && fetch.variables?.fileId === r.fileId;
        const facts = [r.hashMatch ? t('onlineSubs.matches') : null, r.hearingImpaired ? t('onlineSubs.hearingImpaired') : null, r.machineTranslated ? t('onlineSubs.machine') : null, t('onlineSubs.downloads', { count: r.downloads })].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={r.fileId}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, busy }}
            disabled={fetch.isPending}
            onPress={() => (r.fetched ? onChosen(r.fetched) : fetch.mutate(r))}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: active ? colors.raised : 'transparent' }}
          >
            {busy ? <ActivityIndicator color={colors.accent} size="small" /> : <Feather name={r.fetched ? 'check' : 'download'} size={16} color={active ? colors.accent : colors.muted} />}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink }} numberOfLines={2}>{r.release || languageName(r.language, appLanguage)}</Text>
              <Text style={{ color: r.hashMatch ? colors.ok : colors.muted, fontSize: 12 }}>{facts}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={{ color: colors.muted, fontSize: 11, paddingHorizontal: 8 }}>{t('onlineSubs.source')}</Text>
    </View>
  );
}
