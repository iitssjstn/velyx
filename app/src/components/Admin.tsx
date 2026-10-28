import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { buttonLook, OUTLINE_INK, styles } from './ui';
import { dialog } from '../lib/dialog';

/** A screen of the Admin tab: scrolls, pulls to refresh, and keeps a readable width on a tablet. */
export function AdminScreen({ title, refreshing, onRefresh, children }: { title?: string; refreshing: boolean; onRefresh: () => void; children: ReactNode }) {
  return (
    <>
      {title !== undefined && <Stack.Screen options={{ title }} />}
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        {children}
      </ScrollView>
    </>
  );
}

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 12 }}>
      {(title || right) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {title ? <Text style={[styles.label, { flex: 1, fontWeight: '600' }]} accessibilityRole="header">{title}</Text> : <View style={{ flex: 1 }} />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/** A small button inside a card; `danger` for what removes or blocks. */
export function SmallButton({ label, onPress, busy, disabled, filled, danger }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; filled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        filled ? buttonLook.filled : buttonLook.outlined,
        { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', opacity: pressed || disabled ? 0.6 : 1 },
        danger && !filled ? { borderColor: colors.danger } : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={{ color: filled ? colors.buttonInk : danger ? colors.danger : OUTLINE_INK, fontWeight: '600', fontSize: 14 }}>{label}</Text>}
    </Pressable>
  );
}

export function Pill({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'danger' }) {
  const color = { muted: colors.muted, accent: colors.accent, ok: colors.ok, warn: '#f0b860', danger: colors.danger }[tone];
  return (
    <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: color, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** Asks first ("Block Anna?"), then runs `action`. */
export function confirmThen(message: string, okLabel: string, cancelLabel: string, action: () => void): void {
  dialog.alert('Vidalune', message, [
    { text: cancelLabel, style: 'cancel' },
    { text: okLabel, style: 'destructive', onPress: action },
  ]);
}

/**
 * A change on the server from the Admin tab: sends it, refreshes what it touches (`keys`), and says
 * what went wrong if it did not work. `variables` tells which item is busy.
 */
export function useAdminAction<V>(run: (vars: V) => Promise<unknown>, keys: unknown[][]) {
  const { t } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
}
