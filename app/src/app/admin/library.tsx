import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, SmallButton, confirmThen } from '../../components/Admin';
import { Button, ErrorState, Field, FocusPressable, Loading, styles } from '../../components/ui';
import {
  defaultFolder,
  foldersPath,
  formProblem,
  insideLibrary,
  isMediaRoot,
  libraryId,
  pickerStart,
  saveRequest,
  type FolderList,
  type LibraryForm,
  type LibraryIssues,
  type LibraryList,
  type LibraryRow,
} from '../../lib/adminLibraries';
import { errorMessage } from '../../lib/connection';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

/** Admin → Libraries → add (no `?id=`) or edit a library: name, type, folder (with a folder picker), remove. */
export default function LibraryScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = libraryId(params.id);
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'libraries'], queryFn: () => api.get<LibraryList>('/api/libraries') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const library = id === null ? null : (q.data.libraries.find((l) => l.id === id) ?? null);
  if (id !== null && !library) {
    return (
      <>
        <Stack.Screen options={{ title: t('libraries.edit') }} />
        <ErrorState error={new Error(t('libraries.notFound'))} />
      </>
    );
  }
  return <Form key={id ?? 'new'} library={library} roots={q.data.mediaRoots} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />;
}

function Form({ library, roots, refreshing, onRefresh }: { library: LibraryRow | null; roots: string[]; refreshing: boolean; onRefresh: () => void }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState<LibraryForm>({ name: library?.name ?? '', type: library?.type ?? 'movies', path: library?.path ?? defaultFolder(roots) });
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const typeLabel = (type: 'movies' | 'shows') => t(type === 'movies' ? 'libraries.movies' : 'libraries.shows');
  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: [serverUrl] });
    router.back();
    dialog.alert('Vidalune', message);
  };
  const save = useMutation({
    mutationFn: async () => {
      const r = saveRequest(form, library?.id ?? null);
      return r.method === 'post' ? api.post(r.path, r.body) : api.put(r.path, r.body);
    },
    onSuccess: () => done(t(library ? 'libraries.updated' : 'libraries.added')),
    onError: (err) => setError(errorMessage(err, t)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/libraries/${library!.id}`),
    onSuccess: () => done(t('libraries.removed')),
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
  const submit = () => {
    const problem = formProblem(form);
    if (problem) return setError(t(problem));
    setError(null);
    save.mutate();
  };
  return (
    <AdminScreen title={t(library ? 'libraries.edit' : 'libraries.add')} refreshing={refreshing} onRefresh={onRefresh}>
      <Card>
        {library ? (
          <Text style={styles.muted}>{t('libraries.typeIs', { type: typeLabel(library.type) })}</Text>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t('libraries.type')}</Text>
            <Chips
              value={form.type}
              choices={(['movies', 'shows'] as const).map((v) => ({ value: v, label: typeLabel(v) }))}
              onChange={(type) =>
                // Follow the type while the name is still empty or a type's name, like the website.
                setForm((f) => ({ ...f, type, name: !f.name || f.name === typeLabel('movies') || f.name === typeLabel('shows') ? typeLabel(type) : f.name }))
              }
            />
          </View>
        )}
        <Field label={t('libraries.name')} value={form.name} maxLength={64} placeholder={typeLabel(form.type)} onChangeText={(name) => setForm((f) => ({ ...f, name }))} />
        <Field
          label={t('libraries.folder')}
          value={form.path}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="/media/movies"
          onChangeText={(path) => setForm((f) => ({ ...f, path }))}
        />
        <View style={{ flexDirection: 'row' }}>
          <SmallButton label={t(browsing ? 'libraries.browseHide' : 'libraries.browse')} onPress={() => setBrowsing((b) => !b)} />
        </View>
        {browsing && (
          <FolderPicker
            start={pickerStart(form.path)}
            onChoose={(path) => {
              setForm((f) => ({ ...f, path }));
              setBrowsing(false);
              setError(null);
            }}
          />
        )}
        <Text style={styles.muted}>{t('libraries.folderHint', { roots: roots.join(', ') })}</Text>
        {isMediaRoot(form.path, roots) && <Text style={[styles.body, { color: '#f0b860' }]}>{t('libraries.broadFolder')}</Text>}
        {error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button label={t(library ? 'libraries.save' : 'libraries.add')} busy={save.isPending} onPress={submit} />
      </Card>
      {library && <Issues library={library} />}
      {library && (
        <Card>
          <SmallButton
            label={t('libraries.remove')}
            danger
            busy={remove.isPending}
            onPress={() => confirmThen(t('libraries.removeConfirm', { name: library.name }), t('libraries.remove'), t('common.cancel'), () => remove.mutate())}
          />
        </Card>
      )}
    </AdminScreen>
  );
}

/** Walks the folders inside the server's media roots (the same list the website uses). */
function FolderPicker({ start, onChoose }: { start: string | null; onChoose: (path: string) => void }) {
  const { api, t, serverUrl } = useSession();
  const [at, setAt] = useState<string | null>(start);
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'library-folders', at], queryFn: () => api.get<FolderList>(foldersPath(at)), retry: false });
  const shown = q.data;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <SmallButton label={t('libraries.up')} disabled={!at} onPress={() => setAt(shown?.parent ?? null)} />
        <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1} ellipsizeMode="head">
          {at ?? t('libraries.roots')}
        </Text>
      </View>
      {shown?.path ? <SmallButton label={t('libraries.choose')} filled onPress={() => onChoose(shown.path!)} /> : null}
      {q.isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : q.error ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.error}>{errorMessage(q.error, t)}</Text>
          <View style={{ flexDirection: 'row' }}>
            <SmallButton label={t('libraries.roots')} onPress={() => setAt(null)} />
          </View>
        </View>
      ) : shown && shown.folders.length === 0 ? (
        <Text style={styles.muted}>{t('libraries.noFolders')}</Text>
      ) : (
        shown?.folders.map((f) => (
          <FocusPressable
            key={f.path}
            accessibilityRole="button"
            accessibilityLabel={f.readable ? f.name : `${f.name}, ${t('libraries.noAccess')}`}
            onPress={() => setAt(f.path)}
            style={({ pressed }) => [{ paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', gap: 8 }, pressed && { backgroundColor: colors.surface }]}
          >
            <Text style={{ color: f.readable ? colors.accent : '#f0b860' }}>{f.readable ? '▸' : '–'}</Text>
            <Text style={[styles.body, { flex: 1 }, !f.readable && { color: colors.muted }]} numberOfLines={1}>
              {f.name}
              {f.readable ? '' : ` (${t('libraries.noAccess')})`}
            </Text>
          </FocusPressable>
        ))
      )}
    </View>
  );
}

/** What went wrong in the last scan of this library. */
function Issues({ library }: { library: LibraryRow }) {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'admin', 'libraries', library.id, 'issues'], queryFn: () => api.get<LibraryIssues>(`/api/libraries/${library.id}/issues`) });
  return (
    <Card title={t('libraries.issues')}>
      {q.isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : !q.data ? (
        <Text style={styles.error}>{errorMessage(q.error, t)}</Text>
      ) : q.data.failed.length + q.data.unrecognized.length === 0 ? (
        <Text style={styles.muted}>{t('libraries.noProblems')}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {q.data.failed.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>{t('libraries.couldNotAnalyze', { n: q.data.failed.length })}</Text>
              <Text style={styles.muted}>{t('libraries.couldNotAnalyzeText')}</Text>
              {q.data.failed.map((f) => (
                <View key={f.id}>
                  <Text style={styles.body}>{insideLibrary(f.path, library.path)}</Text>
                  {f.error ? <Text style={styles.error}>{f.error}</Text> : null}
                </View>
              ))}
            </View>
          )}
          {q.data.unrecognized.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>{t('libraries.notRecognized', { n: q.data.unrecognized.length })}</Text>
              <Text style={styles.muted}>{t('libraries.notRecognizedText')}</Text>
              {q.data.unrecognized.map((f) => (
                <Text key={f.id} style={styles.muted}>
                  {insideLibrary(f.path, library.path)}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
