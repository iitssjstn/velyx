import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, type TextInput } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '../components/ui';
import { Logo } from '../components/Logo';
import { checkPairing, signInWithPassword, startPairing, type Pairing } from '../lib/auth';
import { errorMessage } from '../lib/connection';
import { USER_AGENT, useSession } from '../lib/session';
import { createApi } from '../lib/api';
import * as SecureStore from 'expo-secure-store';
import { connectPending } from '../lib/cloud';
import { colors, radius } from '../lib/theme';

type Mode = 'password' | 'code';

export default function SignIn() {
  const { t, serverName, serverUrl, forgetServer, sessionEnded } = useSession();
  const [mode, setMode] = useState<Mode>('password');
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20, width: '100%', maxWidth: 520, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Logo />
          <View style={{ gap: 6 }}>
            <Text style={styles.title} accessibilityRole="header">{t('signIn.title', { server: serverName ?? 'Vidalune' })}</Text>
            <Text style={styles.muted}>{serverUrl}</Text>
          </View>
          {sessionEnded && (
            <Text style={[styles.body, { color: colors.ink, backgroundColor: colors.raised, borderRadius: radius.md, padding: 12 }]} accessibilityRole="alert">
              {t('signIn.sessionEnded')}
            </Text>
          )}
          <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4 }} accessibilityRole="tablist">
            {(['password', 'code'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                onPress={() => setMode(m)}
                style={{ flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? colors.raised : 'transparent' }}
              >
                <Text style={{ color: mode === m ? colors.ink : colors.muted, fontWeight: '600' }}>{t(m === 'password' ? 'signIn.withPassword' : 'signIn.withCode')}</Text>
              </Pressable>
            ))}
          </View>
          {mode === 'password' ? <PasswordForm /> : <CodeForm />}
          <Button
            label={t('signIn.otherServer')}
            variant="ghost"
            onPress={() => {
              void forgetServer().then(() => router.replace('/cloud'));
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordForm() {
  const { t, api, deviceName, signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await signInWithPassword(api, username, password, deviceName);
      await signIn(res.token, res.user);
      // Came here from the Vidalune account: connect it, so next time no password is needed.
      const signedIn = createApi({ baseUrl: api.baseUrl, token: res.token, userAgent: USER_AGENT });
      await connectPending(SecureStore, (path, body) => signedIn.post(path, body));
      router.replace('/home');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <Field label={t('signIn.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
      <Field ref={passwordRef} label={t('signIn.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <Button label={t('signIn.button')} onPress={() => void submit()} busy={busy} disabled={!username.trim() || !password} />
    </View>
  );
}

/** Shows a code to confirm on the website and signs in as soon as it is confirmed. */
function CodeForm() {
  const { t, api, deviceName, signIn, serverUrl } = useSession();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setPairing(null);
    setExpired(false);
    setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    startPairing(api, deviceName)
      .then((p) => {
        if (!alive.current) return;
        setPairing(p);
        const poll = async () => {
          if (!alive.current) return;
          try {
            const state = await checkPairing(api, p.pollToken);
            if (!alive.current) return;
            if (state.status === 'approved') {
              await signIn(state.token, state.user);
              router.replace('/home');
              return;
            }
            if (state.status === 'expired' || Date.now() > p.expiresAt) {
              setExpired(true);
              return;
            }
          } catch {
            /* a lost connection: keep asking */
          }
          timer = setTimeout(poll, p.interval * 1000);
        };
        timer = setTimeout(poll, p.interval * 1000);
      })
      .catch((err: unknown) => alive.current && setError(errorMessage(err, t)));
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
    // A new code for every attempt; api and deviceName do not change while this form is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (error) {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.error} accessibilityRole="alert">{error}</Text>
        <Button label={t('common.retry')} variant="ghost" onPress={() => setAttempt((a) => a + 1)} />
      </View>
    );
  }
  if (!pairing) return <ActivityIndicator color={colors.accent} />;
  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.body}>{t('signIn.codeIntro')}</Text>
      <Text selectable accessibilityLabel={pairing.code.split('').join(' ')} style={{ color: expired ? colors.faint : colors.ink, fontSize: 40, fontWeight: '700', letterSpacing: 6, textAlign: 'center', fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo' }}>
        {pairing.code}
      </Text>
      <Text style={styles.muted}>{t('signIn.codeWhere', { address: `${serverUrl}/link` })}</Text>
      {expired ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.error}>{t('signIn.codeExpired')}</Text>
          <Button label={t('signIn.newCode')} onPress={() => setAttempt((a) => a + 1)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{t('signIn.codeWaiting')}</Text>
        </View>
      )}
    </View>
  );
}
