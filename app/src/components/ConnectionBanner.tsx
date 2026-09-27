import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';

/**
 * A bar at the top while the device is offline or the server does not answer. What was loaded
 * stays usable underneath; "Try again" loads the open screen again (one attempt per tap — nothing
 * keeps retrying in the background). Not shown in the player, which handles this itself.
 */
export function ConnectionBanner() {
  const { connection, signedIn, t, api } = useSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (connection === 'ok' || !signedIn || pathname.startsWith('/play')) return null;
  const offline = connection === 'offline';
  return (
    <View
      accessibilityRole="alert"
      style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.raised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12 }}
    >
      <Feather name={offline ? 'wifi-off' : 'cloud-off'} size={20} color={colors.danger} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.ink, fontWeight: '600' }}>{t(offline ? 'connection.offline' : 'connection.unreachable')}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t(offline ? 'connection.offlineHint' : 'connection.unreachableHint')}</Text>
      </View>
      {!offline && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              // The open screen's data, and a small request that tells whether the server answers again.
              await Promise.allSettled([qc.refetchQueries({ type: 'active' }), api.get('/api/server/info')]);
            } finally {
              setBusy(false);
            }
          }}
          hitSlop={8}
          style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 })}
        >
          {busy ? <ActivityIndicator size="small" color={colors.accentInk} /> : <Text style={{ color: colors.accentInk, fontWeight: '600' }}>{t('connection.retry')}</Text>}
        </Pressable>
      )}
    </View>
  );
}
