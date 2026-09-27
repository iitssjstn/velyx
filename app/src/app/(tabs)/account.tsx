import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, styles } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

export default function Account() {
  const { t, user, serverName, serverUrl, serverVersion, appVersion, signOut } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const name = user?.displayName || user?.username || '';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 6 }}>
        <Text style={styles.body}>{t('account.signedInAs', { name })}</Text>
        <Text style={styles.muted}>{t('account.server')}: {serverName} · {serverUrl}</Text>
        {serverVersion ? <Text style={styles.muted}>{t('account.version', { version: serverVersion })}</Text> : null}
        <Text style={styles.muted}>{t('account.appVersion', { version: appVersion })}</Text>
      </View>
      <Button
        label={t('account.signOut')}
        variant="ghost"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await signOut();
            qc.clear();
            router.replace('/');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Text style={styles.muted}>{t('account.signOutHint')}</Text>
    </ScrollView>
  );
}
