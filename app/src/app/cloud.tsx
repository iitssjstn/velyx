import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Button, Field, styles } from '../components/ui';
import { Logo } from '../components/Logo';
import { CloudError, createCloud, serverAddresses, sortServers, type CloudAccount, type CloudServer } from '../lib/cloud';
import { findServer, SERVER_PROBLEMS, ServerError } from '../lib/server';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import type { MessageKey } from '../lib/i18n';

/** The Vidalune account the app signed in with (only to list servers; each server has its own sign-in). */
const STORE_KEY = 'vidalune.cloudAccount';
const cloud = createCloud();

const problemKey = (err: unknown): MessageKey => (err instanceof CloudError ? (`cloud.${err.problem}` as MessageKey) : 'cloud.failed');

export default function CloudAccountScreen() {
  const { t, setServer } = useSession();
  const [account, setAccount] = useState<CloudAccount | null | undefined>(undefined);
  const [servers, setServers] = useState<CloudServer[] | null>(null);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (a: CloudAccount) => {
    setError(null);
    try {
      setServers(sortServers(await cloud.servers(a.token)));
    } catch (err) {
      if (err instanceof CloudError && err.problem === 'signedOut') await forget();
      setError(t(problemKey(err)));
    }
  };
  const forget = async () => {
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
    setAccount(null);
    setServers(null);
  };

  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => {
        const a = raw ? (JSON.parse(raw) as CloudAccount) : null;
        setAccount(a);
        if (a) void load(a);
      })
      .catch(() => setAccount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setBusy('account');
    setError(null);
    try {
      const a = mode === 'up' ? await cloud.signUp(email, password) : await cloud.signIn(email, password);
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(a));
      setAccount(a);
      setPassword('');
      await load(a);
    } catch (err) {
      setError(t(problemKey(err)));
    } finally {
      setBusy(null);
    }
  };

  /** Its own address first (fastest at home), then the relay. */
  const open = async (s: CloudServer) => {
    const addresses = serverAddresses(s);
    if (!addresses.length) return;
    setBusy(s.id);
    setError(null);
    let last: unknown = null;
    for (const address of addresses) {
      try {
        const { url, info } = await findServer(address, fetch);
        await setServer(url, info);
        setBusy(null);
        router.replace('/sign-in');
        return;
      } catch (err) {
        last = err;
      }
    }
    setError(t(last instanceof ServerError ? SERVER_PROBLEMS[last.problem] : 'connect.unreachable'));
    setBusy(null);
  };

  const signOut = async () => {
    if (account) await cloud.signOut(account.token);
    await forget();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20, width: '100%', maxWidth: 520, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Logo />
          {account === undefined ? null : account ? (
            <>
              <Text style={styles.title} accessibilityRole="header">{t('cloud.servers')}</Text>
              {servers && servers.length === 0 && <Text style={styles.muted}>{t('cloud.none', { email: account.email })}</Text>}
              {servers?.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => void open(s)}
                  disabled={!serverAddresses(s).length || busy !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !serverAddresses(s).length, busy: busy === s.id }}
                  style={({ pressed }) => ({ padding: 16, borderRadius: 14, backgroundColor: colors.raised, opacity: !serverAddresses(s).length ? 0.6 : pressed || busy === s.id ? 0.8 : 1, gap: 4 })}
                >
                  <Text style={[styles.body, { fontWeight: '600' }]}>{s.name}</Text>
                  <Text style={styles.muted}>
                    {s.online ? t('cloud.online') : t('cloud.offline')} · {s.url ?? s.relayUrl ?? t('cloud.noAddress')}
                  </Text>
                </Pressable>
              ))}
              {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
              <Button label={t('cloud.byAddress')} variant="ghost" onPress={() => router.replace('/connect')} />
              <Button label={t('cloud.signOut', { email: account.email })} variant="ghost" onPress={() => void signOut()} />
            </>
          ) : (
            <>
              <View style={{ gap: 8 }}>
                <Text style={styles.title} accessibilityRole="header">{t('cloud.title')}</Text>
                <Text style={styles.muted}>{t('cloud.intro')}</Text>
              </View>
              <Field label={t('cloud.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
              <Field label={t('cloud.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'up' ? 'new-password' : 'current-password'} returnKeyType="go" onSubmitEditing={() => void submit()} />
              {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
              <Button label={mode === 'up' ? t('cloud.signUp') : t('cloud.signIn')} onPress={() => void submit()} busy={busy === 'account'} disabled={!email.trim() || !password} />
              <Button label={mode === 'up' ? t('cloud.toSignIn') : t('cloud.toSignUp')} variant="ghost" onPress={() => { setMode(mode === 'up' ? 'in' : 'up'); setError(null); }} />
              <Button label={t('cloud.byAddress')} variant="ghost" onPress={() => router.replace('/connect')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
