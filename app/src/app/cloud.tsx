import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Button, Field, styles } from '../components/ui';
import { Logo } from '../components/Logo';
import { autoOpenServer, CLOUD_ACCOUNT_KEY, CloudError, createCloud, serverAddresses, signInWithTicket, sortServers, TicketError, type CloudAccount, type CloudServer } from '../lib/cloud';
import { findServer, SERVER_PROBLEMS, ServerError } from '../lib/server';
import { USER_AGENT, useSession } from '../lib/session';
import { colors } from '../lib/theme';
import type { MessageKey } from '../lib/i18n';

/** The Vidalune account the app signed in with: the only sign-in, for every server it opens. */
const STORE_KEY = CLOUD_ACCOUNT_KEY;
const cloud = createCloud();

const problemKey = (err: unknown): MessageKey => (err instanceof CloudError ? (`cloud.${err.problem}` as MessageKey) : 'cloud.failed');

export default function CloudAccountScreen() {
  const { t, setServer, signIn, deviceName, cloudServerId, signedIn, forgetServer } = useSession();
  // "Choose another server": show the list, do not open the last one again.
  const { choose } = useLocalSearchParams<{ choose?: string }>();
  const autoOpened = useRef(false);
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

  /**
   * Its own address first (fastest at home), then the relay; signed in with the Vidalune account
   * (a one-time ticket) — never with a second password. When that does not work, the reason.
   */
  const open = async (s: CloudServer) => {
    if (!account || !serverAddresses(s).length) return;
    setBusy(s.id);
    setError(null);
    let opened: { ticket: string; addresses: string[] };
    try {
      opened = await cloud.open(account.token, s.id);
    } catch (err) {
      setError(t(problemKey(err)));
      setBusy(null);
      return;
    }
    let last: unknown = null;
    for (const address of opened.addresses) {
      let url: string;
      try {
        const found = await findServer(address, fetch);
        url = found.url;
        await setServer(url, found.info, s.id, opened.addresses);
      } catch (err) {
        last = err;
        continue;
      }
      try {
        const done = await signInWithTicket(url, opened.ticket, deviceName, USER_AGENT);
        await signIn(done.token, done.user);
        setBusy(null);
        router.replace('/home');
      } catch (err) {
        // The server was reached but did not let this account in: say why, and stay on the list.
        await forgetServer();
        setError(err instanceof TicketError && err.message ? err.message : t('cloud.notConnected'));
        setBusy(null);
      }
      return;
    }
    await forgetServer();
    setError(t(last instanceof ServerError ? SERVER_PROBLEMS[last.problem] : 'connect.unreachable'));
    setBusy(null);
  };

  // Straight to the server after signing in: the one opened last (also when the server ended the
  // session), or the only one there is. Not after "Sign out" or "Switch server" (?choose=1): then the
  // person picks from the list. When opening fails, the list stays with the reason.
  const [opening, setOpening] = useState<CloudServer | null>(null);
  useEffect(() => {
    if (autoOpened.current || choose || signedIn || !servers) return;
    const s = autoOpenServer(servers, cloudServerId);
    if (!s) return;
    autoOpened.current = true;
    setOpening(s);
    void open(s).finally(() => setOpening(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, cloudServerId, signedIn, choose]);

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
              {opening && <Text style={styles.muted} accessibilityLiveRegion="polite">{t('cloud.opening', { name: opening.name })}</Text>}
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
              <Button label={t('cloud.signOut', { email: account.email })} variant="ghost" onPress={() => void signOut()} />
              <AddressLink label={t('cloud.byAddress')} />
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
              <AddressLink label={t('cloud.byAddress')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Entering a server's address yourself: for those who know it; small, so nobody takes it for the way in. */
function AddressLink({ label }: { label: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => router.replace('/connect')} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
      <Text style={[styles.muted, { fontSize: 13, textDecorationLine: 'underline' }]}>{label}</Text>
    </Pressable>
  );
}
