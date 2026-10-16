import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useCastState } from 'react-native-google-cast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { castStatus, castStatusOf, setCastStatus, subscribeCastStatus, type CastStatus } from '../lib/castStatus';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';

/** Whether a Chromecast is connected (or connecting), known at once on every screen. */
export function useCastStatus(): CastStatus {
  return useSyncExternalStore(subscribeCastStatus, castStatus);
}

/**
 * Keeps the cast status up to date for the whole app, and shows a bar while a Chromecast is being
 * connected (picking one in the list takes a few seconds before the TV answers).
 */
export function CastStatusBar() {
  const state = useCastState();
  useEffect(() => setCastStatus(castStatusOf(state)), [state]);
  const status = useCastStatus();
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  if (status !== 'connecting') return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('player.castConnecting')}
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 200, elevation: 200, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.raised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12 }}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={{ color: colors.ink, fontWeight: '600' }}>{t('player.castConnecting')}</Text>
    </View>
  );
}
