import type { ReactNode } from 'react';
import { Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/connection';
import { dialog } from '../lib/dialog';
import type { ServerSettings } from '../lib/adminSettings';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { buttonLook, FocusPressable, OUTLINE_INK, styles } from './ui';

/** The server settings, shared by the settings pages; each saves only its own (changed) fields. */
export function useServerSettings() {
  const { api, serverUrl, t } = useSession();
  const qc = useQueryClient();
  const key = [serverUrl, 'admin', 'settings'];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<ServerSettings>('/api/admin/settings') });
  const save = useMutation({
    mutationFn: (body: Partial<ServerSettings>) => api.put<ServerSettings>('/api/admin/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      dialog.alert('Vidalune', t('settings2.saved'));
    },
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
  return { query, save };
}

/** Says a save went wrong (as the other Admin screens do). */
export function useFailed() {
  const { t } = useSession();
  return (err: unknown) => dialog.alert(t('common.error'), errorMessage(err, t));
}

/** An on/off setting with a short explanation. */
export function SwitchRow({ label, hint, value, onChange, disabled, indent, children }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void; disabled?: boolean; indent?: boolean; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingLeft: indent ? 16 : 0, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.body}>{label}</Text>
        {hint ? <Text style={styles.muted}>{hint}</Text> : null}
        {children}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.button, false: colors.line }}
        thumbColor={value ? colors.accent : colors.muted}
      />
    </View>
  );
}

/** One choice out of a few, as a list (a select on the website). */
export function OptionList<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; note?: string | null }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <FocusPressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[on ? buttonLook.filled : buttonLook.outlined, { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 }]}
          >
            <Text style={{ color: on ? colors.buttonInk : OUTLINE_INK, fontWeight: '600' }}>{o.label}</Text>
            {o.note ? <Text style={{ color: on ? colors.buttonInk : colors.muted, fontSize: 13 }}>{o.note}</Text> : null}
          </FocusPressable>
        );
      })}
    </View>
  );
}

/** A status line in the colour of how it is going. */
export function StatusLine({ text, tone = 'muted' }: { text: string; tone?: 'ok' | 'warn' | 'danger' | 'muted' }) {
  const color = { ok: colors.ok, warn: '#f0b860', danger: colors.danger, muted: colors.muted }[tone];
  return (
    <Text style={[styles.muted, { color }]} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={[styles.muted, { fontSize: 13, color: colors.faint }]}>{children}</Text>;
}
