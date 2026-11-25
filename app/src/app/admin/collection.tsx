import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, confirmThen, SmallButton } from '../../components/Admin';
import { Artwork } from '../../components/media';
import { Button, ErrorState, Field, Loading, styles } from '../../components/ui';
import {
  addItemBody,
  collectionBody,
  collectionKeys,
  EMPTY_SMART,
  filterLines,
  inCollection,
  paramId,
  RATINGS,
  removeItemPath,
  RESOLUTIONS,
  searchPath,
  smartBody,
  smartProblem,
  sortKey,
  SORTS,
  watchFilters,
  withKind,
  type SmartDraft,
  type TitleRef,
} from '../../lib/adminCollections';
import type { CollectionSummary, SmartCollection } from '../../lib/collections';
import { errorMessage } from '../../lib/connection';
import { dialog } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';
import type { Card as TitleCard, SearchResults } from '../../lib/types';

type Detail = CollectionSummary & { items: TitleCard[] };

/** Saves on the server, refreshes the viewer screens too, and says what went wrong if it did not work. */
function useSave<V, R>(run: (vars: V) => Promise<R>, done?: (r: R) => void) {
  const { t, serverUrl } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (r) => {
      for (const key of collectionKeys(serverUrl)) void qc.invalidateQueries({ queryKey: key });
      done?.(r);
    },
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
}

/** Admin → one collection: new or existing, by hand (`?id=`) or smart (`?smart=1`). */
export default function AdminCollection() {
  const params = useLocalSearchParams<{ id?: string; smart?: string }>();
  const id = paramId(params.id);
  const [smart, setSmart] = useState(params.smart === '1');
  const { t } = useSession();
  if (id !== null) return smart ? <SmartEdit id={id} /> : <ManualEdit id={id} />;
  return (
    <AdminScreen title={smart ? t('adminCollections.newSmart') : t('adminCollections.new')} refreshing={false} onRefresh={() => undefined}>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{t('adminCollections.type')}</Text>
        <Chips
          value={smart ? 'smart' : 'manual'}
          choices={[
            { value: 'manual', label: t('adminCollections.typeManual') },
            { value: 'smart', label: t('adminCollections.typeSmart') },
          ]}
          onChange={(v) => setSmart(v === 'smart')}
        />
      </View>
      {smart ? <NewSmart /> : <NewManual />}
    </AdminScreen>
  );
}

function NewManual() {
  const { api, t } = useSession();
  const [name, setName] = useState('');
  const [overview, setOverview] = useState('');
  const create = useSave(
    () => api.post<CollectionSummary>('/api/collections', collectionBody(name, overview)),
    (c) => {
      dialog.alert('Vidalune', t('adminCollections.created'));
      router.replace(`/admin/collection?id=${c.id}` as never);
    },
  );
  return (
    <Card>
      <NameFields name={name} overview={overview} onName={setName} onOverview={setOverview} />
      <Button label={t('adminCollections.create')} busy={create.isPending} disabled={!name.trim()} onPress={() => create.mutate(undefined)} />
    </Card>
  );
}

function NameFields({ name, overview, onName, onOverview }: { name: string; overview?: string; onName: (s: string) => void; onOverview?: (s: string) => void }) {
  const { t } = useSession();
  return (
    <>
      <Field label={t('adminCollections.name')} value={name} onChangeText={onName} maxLength={100} placeholder={t('adminCollections.namePlaceholder')} />
      {onOverview && <Field label={t('adminCollections.description')} value={overview} onChangeText={onOverview} maxLength={2000} multiline style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]} />}
    </>
  );
}

function ManualEdit({ id }: { id: number }) {
  const { api, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'collection', id], queryFn: () => api.get<Detail>(`/api/collections/${id}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <ManualForm key={id} c={q.data} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />;
}

function ManualForm({ c, refreshing, onRefresh }: { c: Detail; refreshing: boolean; onRefresh: () => void }) {
  const { api, t } = useSession();
  const [name, setName] = useState(c.name);
  const [overview, setOverview] = useState(c.overview ?? '');
  const save = useSave(() => api.put(`/api/collections/${c.id}`, collectionBody(name, overview)), () => dialog.alert('Vidalune', t('adminCollections.saved')));
  const remove = useSave((item: TitleRef) => api.del(removeItemPath(c.id, item)));
  const add = useSave((item: TitleRef) => api.post(`/api/collections/${c.id}/items`, addItemBody(item)));
  const del = useSave(() => api.del(`/api/collections/${c.id}`), () => {
    dialog.alert('Vidalune', t('adminCollections.deleted'));
    router.back();
  });
  const editable = c.kind === 'manual';
  return (
    <AdminScreen title={c.name} refreshing={refreshing} onRefresh={onRefresh}>
      {!editable ? (
        <Text style={styles.muted}>{t('adminCollections.autoHint')}</Text>
      ) : (
        <Card>
          <NameFields name={name} overview={overview} onName={setName} onOverview={setOverview} />
          <Button label={t('adminCollections.save')} busy={save.isPending} disabled={!name.trim()} onPress={() => save.mutate(undefined)} />
        </Card>
      )}
      <Card title={`${t('adminCollections.items')} (${c.items.length})`}>
        {c.items.length === 0 ? (
          <Text style={styles.muted}>{t('adminCollections.itemsEmpty')}</Text>
        ) : (
          c.items.map((item) => (
            <TitleRow key={`${item.type}-${item.id}`} item={item}>
              {editable && <SmallButton label={t('adminCollections.remove')} danger busy={remove.isPending && remove.variables?.id === item.id && remove.variables.type === item.type} onPress={() => remove.mutate(item)} />}
            </TitleRow>
          ))
        )}
      </Card>
      {editable && <AddTitles items={c.items} adding={add.isPending ? add.variables : undefined} onAdd={(item) => add.mutate(item)} />}
      {editable && (
        <SmallButton
          label={t('adminCollections.delete')}
          danger
          busy={del.isPending}
          onPress={() => confirmThen(t('adminCollections.deleteConfirm', { name: c.name }), t('adminCollections.delete'), t('common.cancel'), () => del.mutate(undefined))}
        />
      )}
    </AdminScreen>
  );
}

function AddTitles({ items, adding, onAdd }: { items: TitleRef[]; adding: TitleRef | undefined; onAdd: (item: TitleRef) => void }) {
  const { api, t, serverUrl } = useSession();
  const [text, setText] = useState('');
  const path = searchPath(text);
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'collection-search', path],
    enabled: path !== null,
    queryFn: ({ signal }) => api.get<SearchResults>(path!, { signal }),
    staleTime: 30_000,
  });
  const results: TitleCard[] = q.data ? [...q.data.movies, ...q.data.shows] : [];
  return (
    <Card title={t('adminCollections.search')}>
      <Field label={t('common.search')} value={text} onChangeText={setText} placeholder={t('adminCollections.searchPlaceholder')} autoCorrect={false} returnKeyType="search" />
      {path === null ? (
        <Text style={styles.muted}>{t('adminCollections.searchShort')}</Text>
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <Text style={styles.error}>{errorMessage(q.error, t)}</Text>
      ) : results.length === 0 ? (
        <Text style={styles.muted}>{t('adminCollections.noResults')}</Text>
      ) : (
        results.map((item) => {
          const here = inCollection(items, item);
          return (
            <TitleRow key={`${item.type}-${item.id}`} item={item}>
              <SmallButton
                label={here ? t('adminCollections.added') : t('adminCollections.add')}
                filled={!here}
                disabled={here}
                busy={adding?.id === item.id && adding.type === item.type}
                onPress={() => onAdd({ type: item.type, id: item.id })}
              />
            </TitleRow>
          );
        })
      )}
    </Card>
  );
}

function TitleRow({ item, children }: { item: TitleCard; children?: React.ReactNode }) {
  const { t } = useSession();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Artwork path={item.posterPath} size="w185" label={item.title} style={{ width: 40, height: 60, borderRadius: radius.sm, backgroundColor: colors.bg }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.body} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.muted}>
          {t(item.type === 'movie' ? 'adminCollections.movie' : 'adminCollections.show')}
          {item.year ? ` · ${item.year}` : ''}
        </Text>
      </View>
      {children}
    </View>
  );
}

function NewSmart() {
  const { api, t, serverUrl } = useSession();
  const [name, setName] = useState('');
  const [d, setD] = useState<SmartDraft>(EMPTY_SMART);
  const set = (patch: Partial<SmartDraft>) => setD((x) => ({ ...x, ...patch }));
  const genres = useQuery({
    queryKey: [serverUrl, 'genres', d.kind],
    queryFn: () => api.get<{ id: number; name: string; count: number }[]>(`/api/genres?type=${d.kind}`),
    staleTime: 5 * 60_000,
  });
  const create = useSave(() => api.post('/api/collections/smart', smartBody(name, d)), () => {
    dialog.alert('Vidalune', t('adminCollections.saved'));
    router.back();
  });
  const submit = () => {
    const problem = smartProblem(name, d);
    if (problem) dialog.alert('Vidalune', t(problem));
    else create.mutate(undefined);
  };
  const label = (key: Parameters<typeof t>[0], children: React.ReactNode) => (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{t(key)}</Text>
      {children}
    </View>
  );
  return (
    <>
      <Card>
        <NameFields name={name} onName={setName} />
      </Card>
      <Card title={t('adminCollections.rules')}>
        {label(
          'adminCollections.kind',
          <Chips
            value={d.kind}
            choices={[
              { value: 'movies', label: t('adminCollections.kindMovies') },
              { value: 'shows', label: t('adminCollections.kindShows') },
            ]}
            onChange={(kind) => setD((x) => withKind(x, kind))}
          />,
        )}
        {label('adminCollections.watch', <Chips value={d.filter} choices={watchFilters(d.kind).map((f) => ({ value: f.value, label: t(f.key) }))} onChange={(filter) => set({ filter })} />)}
        {d.kind === 'movies' &&
          label(
            'adminCollections.quality',
            <View style={{ gap: 8 }}>
              <Chips value={d.resolution} choices={[{ value: '', label: t('adminCollections.anyRating') }, ...RESOLUTIONS.map((r) => ({ value: r, label: r === 'sd' ? 'SD' : r === '4k' ? '4K' : r }))]} onChange={(resolution) => set({ resolution })} />
              <Chips value={d.hdr ? 'hdr' : ''} choices={[{ value: '', label: t('adminCollections.anyRating') }, { value: 'hdr', label: 'HDR' }]} onChange={(v) => set({ hdr: v === 'hdr' })} />
            </View>,
          )}
        {label(
          'adminCollections.genre',
          <Chips value={d.genre} choices={[{ value: '', label: t('adminCollections.anyGenre') }, ...(genres.data ?? []).map((g) => ({ value: String(g.id), label: g.name }))]} onChange={(genre) => set({ genre })} />,
        )}
        {label('adminCollections.rating', <Chips value={d.minRating} choices={[{ value: '', label: t('adminCollections.anyRating') }, ...RATINGS.map((r) => ({ value: r, label: `${r}+` }))]} onChange={(minRating) => set({ minRating })} />)}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('adminCollections.yearFrom')} value={d.yearFrom} onChangeText={(yearFrom) => set({ yearFrom })} keyboardType="number-pad" maxLength={4} placeholder="1990" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('adminCollections.yearTo')} value={d.yearTo} onChangeText={(yearTo) => set({ yearTo })} keyboardType="number-pad" maxLength={4} placeholder="1999" />
          </View>
        </View>
        {d.kind === 'movies' && <Field label={t('adminCollections.maxRuntime')} value={d.maxRuntime} onChangeText={(maxRuntime) => set({ maxRuntime })} keyboardType="number-pad" maxLength={4} placeholder="95" />}
        {label(
          'adminCollections.sort',
          <Chips value={d.sort} choices={SORTS.filter((s) => d.kind === 'movies' || s !== 'runtime').map((s) => ({ value: s, label: t(sortKey(s)) }))} onChange={(sort) => set({ sort })} />,
        )}
      </Card>
      <Button label={t('adminCollections.create')} busy={create.isPending} disabled={!name.trim()} onPress={submit} />
    </>
  );
}

function SmartEdit({ id }: { id: number }) {
  const { api, t, serverUrl } = useSession();
  const q = useQuery({ queryKey: [serverUrl, 'collections', 'smart'], queryFn: () => api.get<SmartCollection[]>('/api/collections/smart') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data.find((x) => x.custom && x.id === id);
  if (!c) return <ErrorState error={new Error(t('adminCollections.none'))} onRetry={() => void q.refetch()} />;
  return <SmartForm key={id} c={c} id={id} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />;
}

function SmartForm({ c, id, refreshing, onRefresh }: { c: SmartCollection; id: number; refreshing: boolean; onRefresh: () => void }) {
  const { api, t, serverUrl } = useSession();
  const [name, setName] = useState(c.name);
  const genres = useQuery({
    queryKey: [serverUrl, 'genres', c.kind],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/api/genres?type=${c.kind}`),
    enabled: Boolean(c.query.genre),
    staleTime: 5 * 60_000,
  });
  const save = useSave(() => api.put(`/api/collections/${id}`, { name: name.trim() }), () => dialog.alert('Vidalune', t('adminCollections.saved')));
  const del = useSave(() => api.del(`/api/collections/${id}`), () => {
    dialog.alert('Vidalune', t('adminCollections.deleted'));
    router.back();
  });
  const lines = filterLines(c, (g) => genres.data?.find((x) => String(x.id) === g)?.name);
  return (
    <AdminScreen title={c.name} refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: c.name }} />
      <Card>
        <NameFields name={name} onName={setName} />
        <Button label={t('adminCollections.save')} busy={save.isPending} disabled={!name.trim()} onPress={() => save.mutate(undefined)} />
      </Card>
      <Card title={t('adminCollections.rules')}>
        <Text style={styles.body}>{t(c.kind === 'movies' ? 'adminCollections.kindMovies' : 'adminCollections.kindShows')} · {t('adminCollections.count', { n: c.count })}</Text>
        {lines.length === 0 ? <Text style={styles.muted}>{t('adminCollections.noRules')}</Text> : lines.map((l) => <Text key={l.key} style={styles.body}>• {t(l.key, l.params)}</Text>)}
        <Text style={styles.muted}>{t('adminCollections.rulesFixed')}</Text>
      </Card>
      <SmallButton
        label={t('adminCollections.delete')}
        danger
        busy={del.isPending}
        onPress={() => confirmThen(t('adminCollections.deleteConfirm', { name: c.name }), t('adminCollections.delete'), t('common.cancel'), () => del.mutate(undefined))}
      />
    </AdminScreen>
  );
}
