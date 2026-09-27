import type { ReactNode, Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius } from '../lib/theme';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';

export function Button({ label, onPress, busy, disabled, variant = 'primary' }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, variant === 'primary' ? styles.primary : styles.ghost, (pressed || off) && { opacity: off ? 0.5 : 0.8 }]}
    >
      {busy ? <ActivityIndicator color={variant === 'primary' ? colors.accentInk : colors.ink} /> : <Text style={[styles.buttonText, variant === 'primary' ? { color: colors.accentInk } : { color: colors.ink }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ref, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput ref={ref} placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel={label} {...props} />
    </View>
  );
}

export function Loading() {
  const { t } = useSession();
  return (
    <View style={styles.center} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useSession();
  const message = errorMessage(error, t);
  return (
    <View style={[styles.center, { gap: 16, padding: 24 }]}>
      <Text style={[styles.body, { textAlign: 'center' }]}>{message}</Text>
      {onRetry && <Button label={t('common.retry')} onPress={onRetry} variant="ghost" />}
    </View>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function ProgressLine({ fraction }: { fraction: number }) {
  if (fraction <= 0) return null;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  button: { height: 48, borderRadius: radius.pill, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.raised },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { color: colors.muted, fontSize: 14 },
  input: { height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 14, fontSize: 16 },
  title: { color: colors.ink, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.ink, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.accent },
});
