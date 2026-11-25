import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AdminScreen, Card, Chips, SmallButton, useAdminAction } from '../../components/Admin';
import { ErrorState, FocusPressable, Loading, styles } from '../../components/ui';
import { formatBytes } from '../../lib/admin';
import {
  HEALTH_GROUPS,
  healthListPath,
  healthPages,
  healthSummaryPath,
  healthTarget,
  needsAttention,
  notAnalyzed,
  playbackShares,
  playbackTone,
  type HealthCategory,
  type HealthItem,
  type HealthSummary,
  type LibraryList,
} from '../../lib/adminLibraries';
import { errorMessage } from '../../lib/connection';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

const WARN = '#f0b860';
const TONE = { ok: colors.ok, accent: colors.accent, warn: WARN, danger: colors.danger };

/** Admin → Library health: what the libraries hold, how files play, and what needs attention. */
export default function Health() {
  const { api, t, serverUrl, language } = useSession();
  const [library, setLibrary] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const libs = useQuery({ queryKey: [serverUrl, 'admin', 'libraries'], queryFn: () => api.get<LibraryList>('/api/libraries') });
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'health', library, language],
    queryFn: () => api.get<HealthSummary>(healthSummaryPath(library)),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.analysis.running ? 5000 : false),
  });
  const analyze = useAdminAction(() => api.post('/api/admin/compatibility/analyze', {}), [[serverUrl, 'admin', 'health']]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const refresh = () => {
    void q.refetch();
    void libs.refetch();
  };
  if (libs.data && libs.data.libraries.length === 0) {
    return (
      <AdminScreen title={t('admin.health')} refreshing={q.isRefetching} onRefresh={refresh}>
        <Card>
          <Text style={styles.muted}>{t('health.noLibraries')}</Text>
        </Card>
      </AdminScreen>
    );
  }
  const { categories, files, analysis, totals, tmdbConfigured } = q.data;
  const waiting = notAnalyzed(categories);
  const current = categories.find((c) => c.key === selected) ?? null;
  const n = (v: number) => v.toLocaleString(language);
  return (
    <AdminScreen title={t('admin.health')} refreshing={q.isRefetching} onRefresh={refresh}>
      <Text style={styles.muted}>{t('health.intro')}</Text>
      {libs.data && libs.data.libraries.length > 1 && (
        <Chips
          value={library === null ? '' : String(library)}
          choices={[{ value: '', label: t('health.allLibraries') }, ...libs.data.libraries.map((l) => ({ value: String(l.id), label: l.name }))]}
          onChange={(v) => {
            setLibrary(v ? Number(v) : null);
            setPage(1);
          }}
        />
      )}
      {totals && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['health.totals.movies', n(totals.movies)],
              ['health.totals.shows', n(totals.shows)],
              ['health.totals.episodes', n(totals.episodes)],
              ['health.totals.files', n(files)],
              ['health.totals.size', formatBytes(totals.bytes)],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={{ backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, minWidth: '30%', flexGrow: 1 }}>
              <Text style={[styles.muted, { fontSize: 12 }]}>{t(label)}</Text>
              <Text style={[styles.body, { fontSize: 18, fontWeight: '700' }]}>{value}</Text>
            </View>
          ))}
        </View>
      )}
      {(waiting > 0 || analysis.running) && (
        <Card>
          <Text style={styles.body}>{analysis.running ? t('health.analysing', { done: n(analysis.done), total: n(analysis.total) }) : t('health.notAnalyzed', { n: waiting })}</Text>
          {!analysis.running && (
            <View style={{ flexDirection: 'row' }}>
              <SmallButton label={t('health.analyseNow')} busy={analyze.isPending} onPress={() => analyze.mutate(undefined)} />
            </View>
          )}
        </Card>
      )}
      {HEALTH_GROUPS.map((g) => {
        const list = categories.filter((c) => c.group === g.key);
        if (!list.length) return null;
        return (
          <Card key={g.key} title={t(g.title)}>
            <Text style={styles.muted}>
              {g.key === 'playback' ? `${t('health.files', { n: n(files) })} · ` : ''}
              {t(g.hint)}
            </Text>
            {g.key === 'playback' && <PlaybackBar categories={categories} files={files} />}
            <View style={{ gap: 6 }}>
              {list.map((c) => (
                <Tile
                  key={c.key}
                  c={c}
                  selected={c.key === selected}
                  count={n(c.count)}
                  onPress={() => {
                    setSelected(c.key === selected ? null : c.key);
                    setPage(1);
                  }}
                />
              ))}
            </View>
            {current && current.group === g.key && (
              <CategoryList category={current} library={library} page={page} onPage={setPage} onClose={() => setSelected(null)} tmdbConfigured={tmdbConfigured} />
            )}
          </Card>
        );
      })}
    </AdminScreen>
  );
}

function PlaybackBar({ categories, files }: { categories: HealthCategory[]; files: number }) {
  const parts = playbackShares(categories, files);
  if (!parts.length) return null;
  return (
    <View style={{ flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.line }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {parts.map((p) => {
        const tone = playbackTone(p.key);
        return <View key={p.key} style={{ width: `${p.share * 100}%`, backgroundColor: tone ? TONE[tone] : colors.line }} />;
      })}
    </View>
  );
}

function Tile({ c, selected, count, onPress }: { c: HealthCategory; selected: boolean; count: string; onPress: () => void }) {
  const attention = needsAttention(c);
  const tone = playbackTone(c.key);
  const dot = tone ? TONE[tone] : attention ? WARN : colors.line;
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={c.description}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: selected ? colors.accent : colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
      <Text style={[styles.body, { flex: 1 }, c.count === 0 && { color: colors.muted }]}>{c.label}</Text>
      <Text style={[styles.body, { fontWeight: '700' }, c.count === 0 ? { color: colors.faint } : attention ? { color: WARN } : null]}>{count}</Text>
    </FocusPressable>
  );
}

function CategoryList({ category, library, page, onPage, onClose, tmdbConfigured }: { category: HealthCategory; library: number | null; page: number; onPage: (p: number) => void; onClose: () => void; tmdbConfigured: boolean }) {
  const { api, t, serverUrl, language } = useSession();
  const q = useQuery({
    queryKey: [serverUrl, 'admin', 'health', category.key, library, page, language],
    queryFn: () => api.get<{ total: number; items: HealthItem[] }>(healthListPath(category.key, page, library)),
    placeholderData: keepPreviousData,
  });
  const total = q.data?.total ?? category.count;
  const pages = healthPages(total);
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>{category.label}</Text>
        <SmallButton label={t('health.closeList')} onPress={onClose} />
      </View>
      <Text style={styles.muted}>
        {t(category.unit === 'files' ? 'health.files' : 'health.items', { n: total.toLocaleString(language) })} · {category.description}
      </Text>
      {category.key === 'missing-metadata' && !tmdbConfigured && <Text style={[styles.body, { color: WARN }]}>{t('health.noTmdb')}</Text>}
      {q.isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : !q.data ? (
        <Text style={styles.error}>{errorMessage(q.error, t)}</Text>
      ) : q.data.items.length === 0 ? (
        <Text style={styles.muted}>{t('health.nothingHere')}</Text>
      ) : (
        <View style={{ gap: 12, opacity: q.isFetching ? 0.6 : 1 }}>
          {q.data.items.map((item, i) => {
            const target = healthTarget(item.href);
            return (
              <FocusPressable
                key={`${item.kind}-${item.id}-${item.file?.id ?? i}`}
                accessibilityRole={target ? 'link' : undefined}
                disabled={!target}
                onPress={() => target && router.push(target)}
                style={{ gap: 2 }}
              >
                <Text style={[styles.body, { fontWeight: '600' }]}>
                  {item.title}
                  {item.subtitle ? <Text style={styles.muted}>{`  ${item.subtitle}`}</Text> : null}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>{item.library}</Text>
                {item.file && (
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {item.file.summary ? `${item.file.summary} · ` : ''}
                    {formatBytes(item.file.size)} · {item.file.path}
                  </Text>
                )}
                {item.reasons.map((r) => (
                  <Text key={r} style={styles.body}>
                    {r}
                  </Text>
                ))}
              </FocusPressable>
            );
          })}
        </View>
      )}
      {pages > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.muted, { flex: 1 }]}>{t('health.page', { page, pages })}</Text>
          <SmallButton label={t('health.previous')} disabled={page <= 1} onPress={() => onPage(page - 1)} />
          <SmallButton label={t('health.next')} disabled={page >= pages} onPress={() => onPage(page + 1)} />
        </View>
      )}
    </View>
  );
}
