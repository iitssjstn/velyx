import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Button, Field, styles } from '../../components/ui';
import type { Language } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { User } from '../../lib/types';

export default function Account() {
  const { t, api, user, serverName, serverUrl, serverVersion, appVersion, deviceName, signOut, forgetServer, updateUser } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const leave = async (thenForget: boolean) => {
    setBusy(true);
    try {
      await signOut();
      if (thenForget) await forgetServer();
      qc.clear();
      router.replace(thenForget ? '/cloud' : '/');
    } finally {
      setBusy(false);
    }
  };
  const confirm = (message: string, action: () => void) =>
    Alert.alert('Vidalune', message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.ok'), style: 'destructive', onPress: action },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      {user && <Profile user={user} onSaved={updateUser} />}

      <Section title={t('account.language')}>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {(['en', 'nl'] as const).map((lang) => (
            <LanguageChoice
              key={lang}
              lang={lang}
              selected={user?.language === lang}
              onPress={async () => {
                try {
                  const r = await api.put<{ user: User }>('/api/account/language', { language: lang });
                  await updateUser(r.user);
                  void qc.invalidateQueries();
                } catch (err) {
                  Alert.alert(t('common.error'), (err as Error).message);
                }
              }}
            />
          ))}
        </View>
      </Section>

      <Section title={t('account.security')}>
        <Row icon="key" label={t('account.password')} href="/account/password" />
        <Row icon="smartphone" label={t('account.sessions')} href="/account/sessions" />
      </Section>

      <Section title={t('account.aboutApp')}>
        <Text style={styles.muted}>
          {t('account.server')}: {serverName} · {serverUrl}
        </Text>
        {serverVersion ? <Text style={styles.muted}>{t('account.version', { version: serverVersion })}</Text> : null}
        <Text style={styles.muted}>{t('account.appVersion', { version: appVersion })}</Text>
        <Text style={styles.muted}>{t('account.device', { name: deviceName })}</Text>
      </Section>

      <Button label={t('account.signOut')} variant="ghost" busy={busy} onPress={() => confirm(t('account.signOutConfirm'), () => void leave(false))} />
      <Text style={styles.muted}>{t('account.signOutHint')}</Text>
      <Button label={t('account.switchServer')} variant="ghost" disabled={busy} onPress={() => confirm(t('account.switchServerConfirm'), () => void leave(true))} />
    </ScrollView>
  );
}

function Profile({ user, onSaved }: { user: User; onSaved: (u: User) => Promise<void> }) {
  const { t, api } = useSession();
  const [name, setName] = useState(user.displayName ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(user.displayName ?? ''), [user.displayName]);
  const changed = name.trim() !== (user.displayName ?? '');
  return (
    <Section title={t('account.profile')}>
      <Text style={styles.muted}>{t('account.username', { name: user.username })}</Text>
      <Field label={t('account.displayName')} value={name} onChangeText={(v) => (setName(v), setState('idle'))} maxLength={64} returnKeyType="done" />
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button
          label={t('account.save')}
          busy={state === 'busy'}
          disabled={!changed}
          onPress={async () => {
            setState('busy');
            setError(null);
            try {
              const r = await api.put<{ user: User }>('/api/account/profile', { displayName: name.trim() || null });
              await onSaved(r.user);
              setState('saved');
            } catch (err) {
              setError((err as Error).message || t('common.error'));
              setState('idle');
            }
          }}
        />
        {state === 'saved' && <Text style={[styles.muted, { color: colors.ok }]}>{t('account.saved')}</Text>}
      </View>
    </Section>
  );
}

function LanguageChoice({ lang, selected, onPress }: { lang: Language; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={selected ? undefined : onPress}
      style={{ flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent : colors.raised }}
    >
      <Text style={{ color: selected ? colors.accentInk : colors.ink, fontWeight: '600' }}>{lang === 'nl' ? 'Nederlands' : 'English'}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 10 }}>
      <Text style={[styles.label, { fontWeight: '600' }]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function Row({ icon, label, href }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; href: Href }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      <Feather name={icon} size={18} color={colors.muted} />
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      <Feather name="chevron-right" size={18} color={colors.faint} />
    </Pressable>
  );
}
