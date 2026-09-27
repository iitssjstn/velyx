import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, type TextInput } from 'react-native';
import { Stack, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Button, Field, styles } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/** Change the account's password (checked by the server, which also enforces its rules). */
export default function ChangePassword() {
  const { t, api } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [others, setOthers] = useState(true);
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
    setBusy(true);
    try {
      const r = await api.post<{ ok: true; signedOut: number }>('/api/account/password', { currentPassword: current, newPassword: next, signOutOthers: others });
      setDone(r.signedOut > 0 ? t('account.passwordChangedOthers', { n: r.signedOut }) : t('account.passwordChanged'));
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 0 ? t('common.unreachable') : (err as Error).message || t('common.error'));
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
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: others }} onPress={() => setOthers((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <Feather name={others ? 'check-square' : 'square'} size={20} color={others ? colors.accent : colors.muted} />
              <Text style={[styles.body, { flex: 1 }]}>{t('account.signOutOthers')}</Text>
            </Pressable>
            {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            <Button label={t('account.password')} busy={busy} disabled={!current || !next || !again} onPress={() => void submit()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
