import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, HeartPulse, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader, Spinner } from '../../components/States';
import { toast } from '../../components/Toast';
import { intlLocale, t, useT, type MessageKey } from '../../i18n';

export interface HealthCategory {
  key: string;
  label: string;
  group: 'playback' | 'formats' | 'library';
  unit: 'files' | 'items';
  description: string;
  count: number;
}

export interface HealthSummary {
  categories: HealthCategory[];
  files: number;
  tmdbConfigured: boolean;
  analysis: { running: boolean; done: number; total: number; failed: number };
}

export interface HealthItem {
  kind: 'movie' | 'episode' | 'show';
  id: number;
  title: string;
  subtitle: string | null;
  href: string;
  library: string;
  file: { id: number; path: string; size: number; summary: string } | null;
  reasons: string[];
}

const PAGE_SIZE = 50;

const GROUPS: { key: HealthCategory['group']; title: MessageKey; hint: MessageKey }[] = [
  { key: 'playback', title: 'health.groups.playback', hint: 'health.groups.playbackHint' },
  { key: 'formats', title: 'health.groups.formats', hint: 'health.groups.formatsHint' },
  { key: 'library', title: 'health.groups.library', hint: 'health.groups.libraryHint' },
];

/** Colour per playback category; other categories use a neutral dot. */
const DOT: Record<string, string> = { direct: 'bg-ok', remux: 'bg-accent', 'browser-dependent': 'bg-amber', unsupported: 'bg-danger' };

/** Categories that are a problem when not empty (shown in amber). */
const ATTENTION = new Set(['unsupported', 'scan-errors', 'missing-metadata', 'missing-artwork', 'duplicates']);

function countLabel(c: Pick<HealthCategory, 'unit'>, n: number): string {
  return c.unit === 'files' ? t('dashboard.fileCount', { count: n }) : t('collections.itemCount', { count: n });
}

function Tile({ c, selected, onSelect }: { c: HealthCategory; selected: boolean; onSelect: () => void }) {
  const attention = ATTENTION.has(c.key) && c.count > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={c.description}
      className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left transition sm:gap-3 sm:px-4 ${selected ? 'border-accent bg-accent/10' : 'border-line/70 bg-surface hover:border-line hover:bg-raised/60'}`}
    >
      <span className={`size-2.5 shrink-0 rounded-full ${DOT[c.key] ?? (attention ? 'bg-amber' : 'bg-line')}`} aria-hidden />
      <span className={`flex-1 text-sm ${c.count === 0 ? 'text-muted' : ''}`}>{c.label}</span>
      <span className={`font-display text-lg font-semibold tabular-nums ${c.count === 0 ? 'text-faint' : attention ? 'text-amber' : ''}`}>{c.count.toLocaleString(intlLocale())}</span>
    </button>
  );
}

function PlaybackBar({ categories, files }: { categories: HealthCategory[]; files: number }) {
  const parts = categories.filter((c) => c.group === 'playback' && c.count > 0);
  if (!files || !parts.length) return null;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
      {parts.map((c) => (
        <div key={c.key} className={DOT[c.key]} style={{ width: `${(c.count / files) * 100}%` }} />
      ))}
    </div>
  );
}

function CategoryList({ category, libraryId, page, onPage, onClose, tmdbConfigured }: { category: HealthCategory; libraryId: string | null; page: number; onPage: (p: number) => void; onClose: () => void; tmdbConfigured: boolean }) {
  const { t, tRich, lang } = useT();
  const q = useQuery({
    queryKey: ['admin', 'health', category.key, libraryId, page, lang],
    queryFn: () => api.get<{ total: number; items: HealthItem[] }>(`/api/admin/health/${category.key}?page=${page}&limit=${PAGE_SIZE}${libraryId ? `&libraryId=${libraryId}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const total = q.data?.total ?? category.count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section className="panel p-5" aria-labelledby="health-list-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="health-list-title" className="font-display text-xl font-semibold">{category.label}</h2>
          <p className="mt-1 text-sm text-muted">
            {countLabel(category, total)} · {category.description}
          </p>
          {category.key === 'missing-metadata' && !tmdbConfigured && (
            <p className="mt-2 text-sm text-amber">
              {tRich('health.noTmdb', { link: <Link to="/admin/server" className="underline underline-offset-4">{t('admin.tabs.server')}</Link> })}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink" aria-label={t('health.closeList')}>
          <X className="size-4" />
        </button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-12"><Spinner className="size-6" /></div>
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('health.nothingHere')}</p>
      ) : (
        <ul className={`mt-4 divide-y divide-line/60 ${q.isFetching ? 'opacity-60' : ''}`}>
          {q.data.items.map((item, i) => (
            <li key={`${item.kind}-${item.id}-${item.file?.id ?? i}`} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link to={item.href} className="font-medium hover:text-accent">{item.title}</Link>
                {item.subtitle && <span className="text-sm text-muted">{item.subtitle}</span>}
                <span className="ml-auto text-xs text-faint">{item.library}</span>
              </div>
              {item.file && (
                <p className="mt-0.5 text-xs text-muted">
                  {item.file.summary && <span className="text-ink/80">{item.file.summary}</span>}
                  {item.file.summary && ' · '}
                  {formatBytes(item.file.size)} · <span className="break-all">{item.file.path}</span>
                </p>
              )}
              {item.reasons.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-ink/85">
                  {item.reasons.map((r) => (
                    <li key={r} className="break-words">{r}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <span className="mr-2 text-muted">{t('common.pageOf', { page, pages })}</span>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-4" />}>{t('common.previous')}</Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} icon={<ChevronRight className="size-4" />}>{t('common.next')}</Button>
        </div>
      )}
    </section>
  );
}

export function HealthPage() {
  const qc = useQueryClient();
  const { t, lang } = useT();
  const [params, setParams] = useSearchParams();
  const libraryId = params.get('library');
  const selected = params.get('category');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const libs = useQuery({ queryKey: ['libraries'], queryFn: () => api.get<{ libraries: { id: number; name: string }[] }>('/api/libraries') });
  const q = useQuery({
    queryKey: ['admin', 'health', libraryId, lang],
    queryFn: () => api.get<HealthSummary>(`/api/admin/health${libraryId ? `?libraryId=${libraryId}` : ''}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.analysis.running ? 5000 : false),
  });
  const analyze = useMutation({
    mutationFn: () => api.post('/api/admin/compatibility/analyze'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'health'] }),
    onError: (err) => toast.error(err),
  });
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { categories, files, analysis, tmdbConfigured } = q.data;
  const notAnalyzed = categories.find((c) => c.key === 'not-analyzed')?.count ?? 0;
  const current = categories.find((c) => c.key === selected) ?? null;

  if (!libs.isLoading && libs.data && libs.data.libraries.length === 0) {
    return <EmptyState icon={<HeartPulse className="size-6" />} title={t('home.noLibraries')}>{t('health.noLibrariesText')}</EmptyState>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          {t('health.intro')}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('health.library')}</span>
          <select
            value={libraryId ?? ''}
            onChange={(e) => update({ library: e.target.value || null, page: null })}
            className="h-9 rounded-lg border border-line bg-surface px-3"
          >
            <option value="">{t('health.allLibraries')}</option>
            {libs.data?.libraries.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>

      {(notAnalyzed > 0 || analysis.running) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3 text-sm">
          <p>
            {analysis.running
              ? t('health.analysing', { done: analysis.done.toLocaleString(intlLocale()), total: analysis.total.toLocaleString(intlLocale()) })
              : t('health.notAnalyzed', { count: notAnalyzed })}
          </p>
          {!analysis.running && <Button variant="secondary" size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending}>{t('health.analyseNow')}</Button>}
        </div>
      )}

      {GROUPS.map((g) => {
        const list = categories.filter((c) => c.group === g.key);
        return (
          <section key={g.key} aria-labelledby={`health-${g.key}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`health-${g.key}`} className="font-display text-lg font-semibold">{t(g.title)}</h2>
              <p className="text-xs text-faint">{g.key === 'playback' ? `${t('dashboard.fileCount', { count: files })} · ` : ''}{t(g.hint)}</p>
            </div>
            {g.key === 'playback' && (
              <div className="mb-3">
                <PlaybackBar categories={categories} files={files} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {list.map((c) => (
                <Tile key={c.key} c={c} selected={c.key === selected} onSelect={() => update({ category: c.key === selected ? null : c.key, page: null })} />
              ))}
            </div>
            {current && current.group === g.key && (
              <div className="mt-4">
                <CategoryList
                  category={current}
                  libraryId={libraryId}
                  page={page}
                  onPage={(p) => update({ page: String(p) })}
                  onClose={() => update({ category: null, page: null })}
                  tmdbConfigured={tmdbConfigured}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
