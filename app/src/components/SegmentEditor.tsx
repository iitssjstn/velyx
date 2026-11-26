import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SmallButton } from './Admin';
import { styles } from './ui';
import { colors } from '../lib/theme';
import { dialog } from '../lib/dialog';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import type { SegmentEpisode } from '../lib/adminPages';
import { buildBody, centralParts, EDIT_PARTS, formatTime, initialValues, type EditBody, type EditPart, type EditProblem } from '../lib/segmentEdit';
import type { Translate } from '../lib/i18n';

function partLabel(part: EditPart, t: Translate): string {
  return part === 'postCredits' ? t('segmentEdit.postCredits') : t(`report.kind.${part}`);
}

function problemText(p: EditProblem, t: Translate): string {
  return t(p.key, { part: partLabel(p.part, t), length: 'length' in p ? p.length : '' });
}

/** Times of one episode set by hand (recap, intro, credits, after the credits); both fields empty is "none". */
export function SegmentEditor({ episode, onClose }: { episode: SegmentEpisode; onClose: () => void }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const [values, setValues] = useState(() => initialValues(episode.segments));
  const [problem, setProblem] = useState<EditProblem | null>(null);
  const central = centralParts(episode.segments);
  const save = useMutation({
    mutationFn: (body: EditBody) => api.put(`/api/admin/segments/episodes/${episode.id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [serverUrl, 'admin', 'segments'] });
      dialog.alert('Vidalune', t('segmentEdit.saved'));
      onClose();
    },
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
  const submit = () => {
    const r = buildBody(values, episode.duration);
    if ('problem' in r) return setProblem(r.problem);
    setProblem(null);
    save.mutate(r.body);
  };
  const set = (part: EditPart, field: 'start' | 'end', text: string) => setValues((v) => ({ ...v, [part]: { ...v[part], [field]: text } }));
  const input = (part: EditPart, field: 'start' | 'end') => {
    const label = partLabel(part, t);
    const bad = problem?.part === part;
    return (
      <TextInput
        value={values[part][field]}
        onChangeText={(text) => set(part, field, text)}
        placeholder={t(field === 'start' ? 'segmentEdit.start' : 'segmentEdit.end')}
        placeholderTextColor={colors.faint}
        accessibilityLabel={t(field === 'start' ? 'segmentEdit.startOf' : 'segmentEdit.endOf', { part: label })}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { flex: 1, minWidth: 0 }, bad ? { borderColor: colors.danger, borderWidth: 1 } : null]}
      />
    );
  };
  return (
    <View style={{ gap: 10, paddingTop: 6 }}>
      <Text style={styles.muted}>{episode.duration ? t('segmentEdit.hintLength', { length: formatTime(Math.round(episode.duration)) }) : t('segmentEdit.hint')}</Text>
      {central.length > 0 && <Text style={[styles.muted, { color: colors.accent }]}>{t('segmentEdit.central', { parts: central.map((p) => partLabel(p, t).toLowerCase()).join(', ') })}</Text>}
      {EDIT_PARTS.map((part) => (
        <View key={part} style={{ gap: 4 }}>
          <Text style={styles.label}>{partLabel(part, t)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {input(part, 'start')}
            {input(part, 'end')}
            <SmallButton
              label={t('segmentEdit.clear')}
              disabled={!values[part].start && !values[part].end}
              onPress={() => {
                setValues((v) => ({ ...v, [part]: { start: '', end: '' } }));
                if (problem?.part === part) setProblem(null);
              }}
            />
          </View>
        </View>
      ))}
      {problem && <Text style={styles.error} accessibilityLiveRegion="polite">{problemText(problem, t)}</Text>}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <SmallButton label={t('common.cancel')} onPress={onClose} disabled={save.isPending} />
        <SmallButton label={t('segmentEdit.save')} filled busy={save.isPending} onPress={submit} />
      </View>
    </View>
  );
}
