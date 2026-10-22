import { useState } from 'react';
import { Alert, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, FocusPressable, styles } from './ui';
import { errorMessage } from '../lib/connection';
import { openSeasons, seasonsToRequest, toggleSeason, type SeerrDetails } from '../lib/discover';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';

/**
 * The question "Request …?" for the seasons of a show: nothing ticked beforehand, and what is here
 * or asked for already cannot be ticked. Used on a show's request screen and on the screen of a
 * show that is here, so more seasons are asked for without leaving it.
 */
export function SeasonPicker({ details: d, visible, onClose, onRequested }: { details: SeerrDetails; visible: boolean; onClose: () => void; onRequested: (title: string) => void }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<number[]>([]);
  const all = openSeasons(d);
  const picked = chosen.filter((n) => all.includes(n));
  const allPicked = all.length > 0 && picked.length === all.length;
  const close = () => {
    setChosen([]);
    onClose();
  };
  const request = useMutation({
    mutationFn: () => api.post<{ title: string }>('/api/seerr/requests', { mediaType: 'tv', tmdbId: d.tmdbId, seasons: seasonsToRequest(chosen, all) }),
    onSuccess: (r) => {
      close();
      void qc.invalidateQueries({ queryKey: [serverUrl, 'discover'] });
      void qc.invalidateQueries({ queryKey: [serverUrl, 'seerr'] });
      onRequested(r.title);
    },
    onError: (err) => Alert.alert(t('common.error'), errorMessage(err, t)),
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, gap: 12, maxHeight: '85%', width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          <Text style={styles.title} accessibilityRole="header">{t('request.confirmTitle', { title: d.title })}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[styles.muted, { flex: 1 }]}>{t('request.pickSeasons')}</Text>
            {all.length > 1 && (
              <FocusPressable accessibilityRole="button" hitSlop={8} onPress={() => setChosen(allPicked ? [] : all)} style={Platform.isTV ? styles.tvLink : undefined}>
                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>{allPicked ? t('request.selectNone') : t('request.selectAll')}</Text>
              </FocusPressable>
            )}
          </View>
          <ScrollView style={{ flexGrow: 0 }}>
            {d.seasons.map((s) => {
              const free = all.includes(s.seasonNumber);
              const on = free && chosen.includes(s.seasonNumber);
              return (
                <FocusPressable
                  key={s.seasonNumber}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !free }}
                  disabled={!free}
                  onPress={() => setChosen(toggleSeason(chosen, s.seasonNumber, !on))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.sm }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Text style={{ color: colors.accentInk, fontWeight: '800', fontSize: 13 }}>✓</Text>}
                  </View>
                  <Text style={[styles.body, { flex: 1, opacity: free ? 1 : 0.6 }]}>{t('request.season', { n: s.seasonNumber, count: s.episodeCount })}</Text>
                  {!free && s.state ? <Text style={{ color: s.state === 'available' ? colors.ok : colors.accent, fontSize: 12 }}>{t(`request.state.${s.state}`)}</Text> : null}
                </FocusPressable>
              );
            })}
          </ScrollView>
          <Text style={[styles.muted, { fontSize: 13 }]}>{t('request.requestHint')}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            <Button label={t('common.cancel')} variant="ghost" onPress={close} />
            <Button
              label={picked.length === 0 ? t('request.request') : allPicked ? t('request.requestAll') : t('request.requestSeasons', { count: picked.length })}
              busy={request.isPending}
              disabled={picked.length === 0}
              onPress={() => request.mutate()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
