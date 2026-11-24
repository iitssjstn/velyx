import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Artwork } from './media';
import { Button, Field, FocusPressable, OUTLINE_INK, buttonLook, styles } from './ui';
import { useServerAction } from './actions';
import { dialog } from '../lib/dialog';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { CollectionSummary } from '../lib/collections';
import {
  candidateLine,
  collectionRequest,
  managesTitles,
  manualIds,
  matchRequest,
  matchSearchPath,
  matchedRoute,
  refreshNotice,
  refreshPath,
  yearInput,
  type CollectionRef,
  type MatchCandidate,
  type MatchInfo,
  type TitleType,
} from '../lib/adminItem';

const TV = Platform.isTV;
type Shown = 'menu' | 'match' | 'collections' | null;

/**
 * The administrator's ⋯ next to a movie's or show's buttons (as on the website): refresh its
 * metadata, fix the match, add it to a collection. Nothing for other viewers; phone and TV alike.
 */
export function AdminTitleMenu({ type, id, title, year, match, collections }: { type: TitleType; id: number; title: string; year: number | null; match?: MatchInfo; collections?: CollectionRef[] }) {
  const { api, t, serverUrl, user } = useSession();
  const qc = useQueryClient();
  const [shown, setShown] = useState<Shown>(null);
  const refresh = useMutation({
    mutationFn: () => api.post<{ result: string }>(refreshPath(type, id)),
    onSuccess: (r) => dialog.alert('Vidalune', t(refreshNotice(r.result))),
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
    onSettled: () => void qc.invalidateQueries({ queryKey: [serverUrl] }),
  });
  if (!managesTitles(user)) return null;
  const pick = (next: Shown, then?: () => void) => {
    setShown(next);
    then?.();
  };
  return (
    <>
      <FocusPressable
        accessibilityRole="button"
        accessibilityLabel={t('adminItem.moreActions')}
        accessibilityState={{ busy: refresh.isPending }}
        hitSlop={8}
        onPress={() => !refresh.isPending && setShown('menu')}
        style={({ pressed }) => [
          { height: TV ? 48 : 44, width: TV ? 48 : 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, opacity: pressed ? 0.8 : 1 },
          buttonLook.outlined,
          { borderRadius: radius.pill },
          TV && { backgroundColor: 'rgba(20,18,28,0.7)' },
        ]}
      >
        {refresh.isPending ? <ActivityIndicator size="small" color={OUTLINE_INK} /> : <Feather name="more-horizontal" size={20} color={OUTLINE_INK} />}
      </FocusPressable>
      {shown === 'menu' && (
        <Sheet title={title} onClose={() => setShown(null)}>
          <MenuRow first icon="layers" label={t('adminItem.addToCollection')} onPress={() => pick('collections')} />
          <MenuRow icon="search" label={t('adminItem.fixMatch')} onPress={() => pick('match')} />
          <MenuRow icon="refresh-cw" label={t('adminItem.refreshMetadata')} onPress={() => pick(null, () => refresh.mutate())} />
          <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setShown(null)} />
          </View>
        </Sheet>
      )}
      {shown === 'match' && <FixMatch type={type} id={id} query={match?.parsedTitle || title} year={match?.parsedYear ?? year} onClose={() => setShown(null)} />}
      {shown === 'collections' && <Collections type={type} id={id} current={collections} onClose={() => setShown(null)} />}
    </>
  );
}

/** A box over the page in the app's style; Back closes it. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.lg, padding: 20, gap: 12, maxHeight: '88%', width: '100%', maxWidth: TV ? 760 : 560, alignSelf: 'center' }}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function MenuRow({ icon, label, onPress, first }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; first?: boolean }) {
  return (
    <FocusPressable
      accessibilityRole="button"
      hasTVPreferredFocus={first}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.raised, opacity: pressed ? 0.7 : 1 })}
    >
      <Feather name={icon} size={18} color={colors.muted} />
      <Text style={styles.body}>{label}</Text>
    </FocusPressable>
  );
}

/** Search TMDB and pick the right entry; a movie merged into another opens that one. */
function FixMatch({ type, id, query, year, onClose }: { type: TitleType; id: number; query: string; year: number | null; onClose: () => void }) {
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState(query);
  const [yearText, setYearText] = useState(year ? String(year) : '');
  const [path, setPath] = useState(() => matchSearchPath(type, query, year ? String(year) : ''));
  const results = useQuery({ queryKey: [serverUrl, 'match-search', path], enabled: path !== null, queryFn: () => api.get<MatchCandidate[]>(path!), retry: false });
  const apply = useMutation({
    mutationFn: (tmdbId: number) => {
      const r = matchRequest(type, id, tmdbId);
      return api.post<{ id: number }>(r.path, r.body);
    },
    onSuccess: (r) => {
      onClose();
      void qc.invalidateQueries({ queryKey: [serverUrl] });
      const next = matchedRoute(type, id, r.id);
      if (next) router.replace(next);
      dialog.alert('Vidalune', t('fixMatch.updated'));
    },
    onError: (err) => dialog.alert(t('common.error'), errorMessage(err, t)),
  });
  const search = () => setPath(matchSearchPath(type, text, yearText));
  return (
    <Sheet title={t('adminItem.fixMatch')} onClose={onClose}>
      <View style={{ flexDirection: TV ? 'row' : 'column', gap: 10, alignItems: TV ? 'flex-end' : 'stretch' }}>
        <View style={{ flex: TV ? 1 : undefined }}>
          <Field label={type === 'movie' ? t('fixMatch.movieTitle') : t('fixMatch.showTitle')} value={text} onChangeText={setText} returnKeyType="search" onSubmitEditing={search} autoCorrect={false} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View style={{ width: 110 }}>
            <Field label={t('fixMatch.year')} value={yearText} onChangeText={(v) => setYearText(yearInput(v))} keyboardType="number-pad" maxLength={4} onSubmitEditing={search} />
          </View>
          <Button label={t('common.search')} onPress={search} />
        </View>
      </View>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {results.isFetching ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
        ) : results.error ? (
          <Text style={styles.error}>{errorMessage(results.error, t)}</Text>
        ) : results.data && results.data.length === 0 ? (
          <Text style={[styles.muted, { textAlign: 'center', marginVertical: 24 }]}>{t('fixMatch.noResults')}</Text>
        ) : (
          results.data?.map((c) => (
            <FocusPressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${c.title}${c.year ? ` (${c.year})` : ''}`}
              disabled={apply.isPending}
              onPress={() => apply.mutate(c.id)}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 8, borderRadius: radius.md, backgroundColor: colors.raised, opacity: pressed || apply.isPending ? 0.7 : 1 })}
            >
              <Artwork path={c.posterPath} size="w185" label={c.title} style={{ width: 54, height: 81, borderRadius: radius.sm }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={2}>{c.title}</Text>
                <Text style={styles.muted}>{candidateLine(c)}</Text>
                {c.overview ? <Text style={styles.muted} numberOfLines={2}>{c.overview}</Text> : null}
              </View>
            </FocusPressable>
          ))
        )}
      </ScrollView>
      <View style={{ alignItems: 'flex-end' }}>
        <Button label={t('common.close')} variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** Tick the collections an administrator made; a new one is made on the website. */
function Collections({ type, id, current, onClose }: { type: TitleType; id: number; current?: CollectionRef[]; onClose: () => void }) {
  const { api, t, serverUrl } = useSession();
  const send = useServerAction();
  const [member, setMember] = useState(() => new Set(manualIds(current)));
  const [busy, setBusy] = useState<number | null>(null);
  const q = useQuery({ queryKey: [serverUrl, 'collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const manual = q.data?.filter((c) => c.kind === 'manual') ?? [];
  const flip = async (collectionId: number) => {
    if (busy !== null) return;
    const add = !member.has(collectionId);
    const set = (on: boolean) =>
      setMember((prev) => {
        const next = new Set(prev);
        if (on) next.add(collectionId);
        else next.delete(collectionId);
        return next;
      });
    set(add);
    setBusy(collectionId);
    if (!(await send(collectionRequest(type, id, collectionId, add)))) set(!add);
    setBusy(null);
  };
  return (
    <Sheet title={t('adminItem.addToCollection')} onClose={onClose}>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
        ) : q.error ? (
          <Text style={styles.error}>{errorMessage(q.error, t)}</Text>
        ) : manual.length === 0 ? (
          <Text style={styles.muted}>{t('adminItem.noCollections')}</Text>
        ) : (
          manual.map((c, i) => {
            const on = member.has(c.id);
            return (
              <FocusPressable
                key={c.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, busy: busy === c.id }}
                hasTVPreferredFocus={i === 0}
                onPress={() => void flip(c.id)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.raised, opacity: pressed ? 0.7 : 1 })}
              >
                {busy === c.id ? <ActivityIndicator size="small" color={colors.accent} /> : <Feather name={on ? 'check-square' : 'square'} size={18} color={on ? colors.accent : colors.muted} />}
                <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.muted}>{c.itemCount}</Text>
              </FocusPressable>
            );
          })
        )}
      </ScrollView>
      <View style={{ alignItems: 'flex-end' }}>
        <Button label={t('common.close')} variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}
