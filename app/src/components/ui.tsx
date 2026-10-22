import { useState, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps } from 'react-native';
import { colors, radius } from '../lib/theme';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import { textEntryDefaults } from '../lib/textEntry';
import { useTvFocus } from './useTvFocus';

/**
 * A Pressable that shows where the focus is: on Android TV / Google TV the remote's arrows move the
 * focus from one to the next and OK presses it. On a phone the focus never lands on it. With children
 * as a function it draws no ring of its own: the children show the focus (a poster with its title
 * under it rings only the poster, see `FocusRing`).
 */
export function FocusPressable({
  style,
  onFocus,
  onBlur,
  ref,
  children,
  ...props
}: Omit<PressableProps, 'children'> & { ref?: Ref<View>; children?: ReactNode | ((focused: boolean) => ReactNode) }) {
  const [focused, setFocused] = useState(false);
  const tvFocus = useTvFocus();
  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={tvFocus.preferred}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        tvFocus.remember();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={(state) => [typeof style === 'function' ? style(state) : style, focused && typeof children !== 'function' && styles.focused]}
    >
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
}

/** The focus ring over artwork, following its rounded corners (lay it over the artwork, not the card). */
export function FocusRing({ focused, radius: r = radius.md }: { focused: boolean; radius?: number }) {
  if (!focused) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: r, borderWidth: 3, borderColor: colors.accent }} />;
}

export function Button({ label, onPress, busy, disabled, variant = 'primary' }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' }) {
  const off = disabled || busy;
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, variant === 'primary' ? styles.primary : styles.ghost, (pressed || off) && { opacity: off ? 0.5 : 0.8 }]}
    >
      {busy ? <ActivityIndicator color={variant === 'primary' ? colors.accentInk : colors.ink} /> : <Text style={[styles.buttonText, variant === 'primary' ? { color: colors.accentInk } : { color: colors.ink }]}>{label}</Text>}
    </FocusPressable>
  );
}

export function Field({ label, ref, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput ref={ref} placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel={label} {...textEntryDefaults(props.secureTextEntry)} {...props} />
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
  // On a TV the ring is drawn inside the item: outside it, a list that clips its children (a scroll
  // view, a dialog) cut off its sides, leaving two loose lines above and below.
  /** On the TV a text link gets room around it, so the focus ring (drawn inside) does not cross the text. */
  tvLink: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  focused: { outlineWidth: 3, outlineColor: colors.accent, outlineOffset: Platform.isTV ? -3 : 3, outlineStyle: 'solid' },
});
