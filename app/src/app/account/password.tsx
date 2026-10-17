import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type TextInput } from 'react-native';
import { Stack, router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Button, Field, styles } from '../../components/ui';
import { CLOUD_ACCOUNT_KEY, CloudError, createCloud, type CloudAccount } from '../../lib/cloud';
import type { MessageKey } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

const cloud = createCloud();

/**
 * Change the password of the Vidalune account: the one the app signs in with (and vidalune.com).
 * Not the server's own password: the app never uses that one, so it could not be confirmed here.
 */
export default function ChangePassword() {
  const { t, language } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const nextRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);

  const submit = async () => {
    setError(null);
    if (next !== again) {
      setError(t('account.passwordMismatch'));
      return;
    }
    if (next.length < 8) {
      setError(t('account.passwordTooShort'));
      return;
    }
    setBusy(true);
    try {
      const account = JSON.parse((await SecureStore.getItemAsync(CLOUD_ACCOUNT_KEY)) ?? 'null') as CloudAccount | null;
      if (!account) throw new CloudError('signedOut');
      await cloud.changePassword(account.token, current, next, language);
      setDone(t('account.passwordChanged'));
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(t(err instanceof CloudError ? (`cloud.${err.problem}` as MessageKey) : 'cloud.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: t('account.password') }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {done ? (
          <View style={{ gap: 16 }}>
            <Text style={[styles.body, { color: colors.ok }]} accessibilityRole="alert">{done}</Text>
            <Button label={t('common.ok')} onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <Field label={t('account.currentPassword')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => nextRef.current?.focus()} />
            <Field ref={nextRef} label={t('account.newPassword')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => againRef.current?.focus()} />
            <Field ref={againRef} label={t('account.confirmPassword')} value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submit()} />
            <Text style={styles.muted}>{t('account.passwordAccountHint')}</Text>
            {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            <Button label={t('account.password')} busy={busy} disabled={!current || !next || !again} onPress={() => void submit()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
