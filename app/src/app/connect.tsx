import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '../components/ui';
import { Logo } from '../components/Logo';
import { findServer, SERVER_PROBLEMS, ServerError } from '../lib/server';
import { useSession } from '../lib/session';

export default function Connect() {
  const { t, setServer, serverUrl } = useSession();
  const [address, setAddress] = useState(serverUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url, info } = await findServer(address, fetch);
      await setServer(url, info);
      router.replace('/sign-in');
    } catch (err) {
      setError(t(err instanceof ServerError ? SERVER_PROBLEMS[err.problem] : 'common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20, width: '100%', maxWidth: 520, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Logo />
          <View style={{ gap: 8 }}>
            <Text style={styles.title} accessibilityRole="header">{t('connect.title')}</Text>
            <Text style={styles.muted}>{t('connect.intro')}</Text>
          </View>
          <Field
            label={t('connect.address')}
            value={address}
            onChangeText={setAddress}
            placeholder={t('connect.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
          />
          {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Button label={t('connect.button')} onPress={() => void connect()} busy={busy} disabled={!address.trim()} />
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={styles.muted}>{t('connect.orAccount')}</Text>
            <Button label={t('connect.withAccount')} variant="ghost" onPress={() => router.replace('/cloud')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
