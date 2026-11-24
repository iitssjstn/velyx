import { useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { FocusPressable, styles } from './ui';
import { dialog } from '../lib/dialog';
import { forgetAudio, storeDevicePrefs, storeSeekStep, storedDevicePrefs, storedSeekStep } from '../lib/remember';
import { useSession } from '../lib/session';
import {
  AUDIO_MODES,
  COUNTDOWNS,
  DEFAULT_DEVICE_PREFS,
  SEEK_STEPS,
  SKIP_MODES,
  SUBTITLE_MODES,
  languageChoices,
  skipModes,
  subtitleFields,
  type AccountPrefs,
  type Choice,
  type DevicePrefs,
} from '../lib/settings';
import type { SeekStep } from '../lib/skip';
import { colors, radius } from '../lib/theme';

const TV = Platform.isTV;
/** Amber, as on the website, for a setting that does not work yet. */
const WARN = '#f2c066';

/** A block on the Account screen with a title and an optional line under it. */
export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 10 }}>
      <Text style={[styles.label, { fontWeight: '600' }]} accessibilityRole="header">{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      {children}
    </View>
  );
}

/**
 * One setting: its name and current value; pressing it opens the choices right under it (touch or
 * the remote's arrows and OK), and choosing one closes them again.
 */
export function ChoiceRow<T extends string>({ label, hint, value, choices, onChange, disabled, warn }: { label: string; hint?: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void; disabled?: boolean; warn?: string }) {
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.value === value)?.label ?? value;
  return (
    <View style={{ opacity: disabled ? 0.45 : 1 }}>
      <FocusPressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1, ...(TV && { paddingHorizontal: 10, borderRadius: radius.sm }) })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.body}>{label}</Text>
          {hint ? <Text style={styles.muted}>{hint}</Text> : null}
          {warn ? <Text style={[styles.muted, { color: WARN }]}>{warn}</Text> : null}
        </View>
        <Text style={[styles.muted, { maxWidth: '45%', textAlign: 'right' }]} numberOfLines={2}>{current}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.faint} />
      </FocusPressable>
      {open && !disabled && (
        <View accessibilityRole="radiogroup" style={{ marginLeft: 8, marginBottom: 6, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 8 }}>
          {choices.map((c) => {
            const selected = c.value === value;
            return (
              <FocusPressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setOpen(false);
                  if (!selected) onChange(c.value);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}
              >
                <Feather name="check" size={16} color={selected ? colors.accent : 'transparent'} />
                <Text style={[styles.body, selected && { color: colors.accent, fontWeight: '600' }]}>{c.label}</Text>
              </FocusPressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Account → languages, skipping and playback: the website's settings, on the phone and the TV. */
export function PlaybackSettings() {
  const { api, t, serverUrl, user } = useSession();
  const qc = useQueryClient();
  const key = [serverUrl, 'account-prefs'];
  const prefs = useQuery({ queryKey: key, queryFn: () => api.get<AccountPrefs>('/api/account/preferences') });
  const device = useQuery({ queryKey: ['device-prefs'], queryFn: storedDevicePrefs, staleTime: 0 });
  const seek = useQuery({ queryKey: ['seek-step'], queryFn: storedSeekStep, staleTime: 0 });
  const lang = user?.language ?? 'en';

  const save = async (patch: Partial<AccountPrefs>) => {
    const before = qc.getQueryData<AccountPrefs>(key);
    if (before) qc.setQueryData<AccountPrefs>(key, { ...before, ...patch });
    try {
      const next = await api.put<AccountPrefs>('/api/account/preferences', patch);
      qc.setQueryData(key, next);
    } catch (err) {
      if (before) qc.setQueryData(key, before);
      dialog.alert(t('settings.saveFailed'), (err as Error).message);
    }
  };
  const saveDevice = (patch: Partial<DevicePrefs>) => {
    const next = { ...(device.data ?? DEFAULT_DEVICE_PREFS), ...patch };
    qc.setQueryData(['device-prefs'], next);
    void storeDevicePrefs(next);
  };

  const p = prefs.data;
  const mode = p?.subtitleMode ?? 'remember';
  const fields = subtitleFields(mode);
  const skip = skipModes(p);
  const skipChoices = SKIP_MODES.map((m) => ({ value: m, label: t(`settings.skipMode.${m}`) }));
  const d = device.data ?? DEFAULT_DEVICE_PREFS;
  return (
    <>
      <SettingsSection title={t('settings.languages')} hint={t('settings.languagesHint')}>
        <ChoiceRow
          label={t('settings.audioLanguage')}
          hint={t('settings.audioHint')}
          value={p?.audioLanguage ?? ''}
          disabled={!p}
          choices={languageChoices(p?.audioLanguage, t('settings.original'), lang)}
          onChange={(v) => {
            // Chosen here wins over the track last chosen in the player (as on the website).
            void forgetAudio();
            void save({ audioLanguage: v || null });
          }}
        />
        <ChoiceRow
          label={t('settings.showSubtitles')}
          hint={t(`settings.modeHint.${mode}`)}
          value={mode}
          disabled={!p}
          choices={SUBTITLE_MODES.map((m) => ({ value: m, label: t(`settings.mode.${m}`) }))}
          onChange={(v) => void save({ subtitleMode: v })}
        />
        <ChoiceRow
          label={t('settings.subtitleLanguage')}
          value={p?.subtitleLanguage ?? ''}
          disabled={!p || !fields.language}
          warn={fields.needsLanguage && !p?.subtitleLanguage ? t('settings.chooseLanguage') : undefined}
          choices={languageChoices(p?.subtitleLanguage, t('settings.none'), lang)}
          onChange={(v) => void save({ subtitleLanguage: v || null })}
        />
        <ChoiceRow
          label={t('settings.fallback')}
          hint={t('settings.fallbackHint')}
          value={p?.subtitleFallback ?? ''}
          disabled={!p || !fields.fallback}
          choices={languageChoices(p?.subtitleFallback, t('settings.none'), lang)}
          onChange={(v) => void save({ subtitleFallback: v || null })}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.skip')} hint={t('settings.skipHint')}>
        <ChoiceRow label={t('settings.skipRecaps')} value={skip.recap} disabled={!p} choices={skipChoices} onChange={(v) => void save({ skipRecap: v })} />
        <ChoiceRow label={t('settings.skipIntros')} value={skip.intro} disabled={!p} choices={skipChoices} onChange={(v) => void save({ skipIntro: v })} />
        <ChoiceRow label={t('settings.skipCredits')} value={skip.credits} disabled={!p} choices={skipChoices} onChange={(v) => void save({ skipCredits: v })} />
      </SettingsSection>

      <SettingsSection title={t('settings.playback')} hint={t('settings.playbackHint')}>
        <ChoiceRow
          label={t('settings.autoplay')}
          hint={t('settings.autoplayHint')}
          value={d.autoplayNext ? 'on' : 'off'}
          choices={[{ value: 'on', label: t('settings.on') }, { value: 'off', label: t('settings.off') }]}
          onChange={(v) => saveDevice({ autoplayNext: v === 'on' })}
        />
        <ChoiceRow
          label={t('settings.countdown')}
          value={String(d.countdown)}
          disabled={!d.autoplayNext}
          choices={COUNTDOWNS.map((s) => ({ value: String(s), label: `${s} s` }))}
          onChange={(v) => saveDevice({ countdown: Number(v) as DevicePrefs['countdown'] })}
        />
        <ChoiceRow
          label={t('player.seekStep')}
          value={String(seek.data ?? 10)}
          choices={SEEK_STEPS.map((s) => ({ value: String(s), label: `${s} s` }))}
          onChange={(v) => {
            const step = Number(v) as SeekStep;
            qc.setQueryData(['seek-step'], step);
            void storeSeekStep(step);
          }}
        />
        <ChoiceRow
          label={t('settings.sound')}
          hint={t('settings.soundHint')}
          value={d.surround ? 'surround' : 'stereo'}
          choices={[{ value: 'stereo', label: t('settings.stereo') }, { value: 'surround', label: t('settings.surround') }]}
          onChange={(v) => saveDevice({ surround: v === 'surround' })}
        />
        <ChoiceRow
          label={t('player.voices')}
          hint={t('settings.voicesHint')}
          value={p?.audioMode ?? 'normal'}
          disabled={!p}
          choices={AUDIO_MODES.map((m) => ({ value: m, label: t(`player.voiceMode.${m}`) }))}
          onChange={(v) => void save({ audioMode: v })}
        />
      </SettingsSection>
    </>
  );
}
