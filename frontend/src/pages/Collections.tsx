import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layers, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Card, CollectionDetail, CollectionSummary, SmartCollection } from '../lib/types';
import { Artwork } from '../components/Artwork';
import { Button } from '../components/Button';
import { PosterCard } from '../components/Cards';
import { DetailHero, MetaList } from '../components/DetailHero';
import { ConfirmModal, Modal } from '../components/Modal';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { toast } from '../components/Toast';
import { intlLocale, t, useT, type MessageKey } from '../i18n';

function itemCountLabel(n: number) {
  return t('collections.itemCount', { count: n });
}

const BUILT_IN: Record<string, MessageKey> = {
  'recently-added': 'smart.builtIn.recentlyAdded',
  unwatched: 'smart.builtIn.unwatched',
  'top-rated': 'smart.builtIn.topRated',
  '4k': 'smart.builtIn.movies4k',
  '1080p': 'smart.builtIn.movies1080p',
  hdr: 'smart.builtIn.hdr',
  short: 'smart.builtIn.short',
  favorites: 'smart.builtIn.favorites',
  'shows-in-progress': 'smart.builtIn.showsInProgress',
  'shows-unwatched': 'smart.builtIn.showsUnwatched',
};

/** Built-in smart collections have a name in every language; custom ones keep the name they were given. */
export function smartName(c: Pick<SmartCollection, 'key' | 'name' | 'custom'>): string {
  return !c.custom && BUILT_IN[c.key] ? t(BUILT_IN[c.key]) : c.name;
}

/** Name + description form, used to create and to edit a manual collection. */
export function CollectionForm({ initial, onDone }: { initial?: CollectionSummary; onDone: (c?: CollectionSummary) => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [overview, setOverview] = useState(initial?.overview ?? '');
  const m = useMutation({
    mutationFn: () =>
      initial
        ? api.put(`/api/collections/${initial.id}`, { name: name.trim(), overview: overview.trim() || null }).then(() => undefined)
        : api.post<CollectionSummary>('/api/collections', { name: name.trim(), overview: overview.trim() || null }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['collections'] });
      void qc.invalidateQueries({ queryKey: ['collection'] });
      toast.success(initial ? t('collections.updated') : t('collections.created'));
      onDone(created ?? undefined);
    },
    onError: (err) => toast.error(err),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="c-name">{t('common.name')}</label>
        <input id="c-name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('collections.namePlaceholder')} />
      </div>
      <div>
        <label className="label" htmlFor="c-overview">{t('common.description')}</label>
        <textarea id="c-overview" className="input min-h-24 py-2" maxLength={2000} value={overview} onChange={(e) => setOverview(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone()}>{t('common.cancel')}</Button>
        <Button type="submit" loading={m.isPending}>{initial ? t('common.save') : t('collections.create')}</Button>
      </div>
    </form>
  );
}

/** Link to the Browse page with a smart collection's filters. */
export function smartHref(c: Pick<SmartCollection, 'kind' | 'query'>): string {
  const qs = new URLSearchParams(c.query).toString();
  return `/${c.kind}${qs ? `?${qs}` : ''}`;
}

/** Saved filters, evaluated for the viewer; they open the Movies/TV Shows page with those filters. */
function SmartCollections({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { t } = useT();
  const q = useQuery({ queryKey: ['collections', 'smart'], queryFn: () => api.get<SmartCollection[]>('/api/collections/smart') });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/collections/${id}`),
    onSuccess: () => {
      toast.success(t('smart.deleted'));
      void qc.invalidateQueries({ queryKey: ['collections', 'smart'] });
    },
    onError: (err) => toast.error(err),
  });
  if (!q.data?.length) return null;
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <Sparkles className="size-5 text-accent" /> {t('smart.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('smart.intro')}</p>
      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {q.data.map((c) => (
          <div key={c.key} className="relative">
            <Link to={smartHref(c)} className="group block focus-visible:outline-none">
              <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent">
                <Artwork path={c.posterPath} title={smartName(c)} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs text-ink backdrop-blur">
                  <Sparkles className="size-3" /> {c.count.toLocaleString(intlLocale())}
                </span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{smartName(c)}</p>
              <p className="text-xs text-faint">{c.kind === 'movies' ? t('nav.movies') : t('nav.tvShows')}</p>
            </Link>
            {isAdmin && c.custom && c.id !== null && (
              <button
                type="button"
                onClick={() => del.mutate(c.id!)}
                className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/70 text-ink backdrop-blur hover:bg-danger hover:text-bg"
                aria-label={t('smart.deleteName', { name: smartName(c) })}
                title={t('common.delete')}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {isAdmin && <p className="mt-4 text-xs text-faint">{t('smart.howTo')}</p>}
    </section>
  );
}

export function CollectionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const isAdmin = user?.role === 'admin';
  return (
    <div className="px-4 pt-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('nav.collections')}</h1>
        {isAdmin && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('collections.new')}
          </Button>
        )}
      </div>
      <SmartCollections isAdmin={isAdmin} />
      {q.data && q.data.length > 0 && <h2 className="mt-10 font-display text-xl font-semibold">{t('nav.collections')}</h2>}
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<Layers className="size-6" />} title={t('collections.empty')}>
          {t('collections.emptyHint')}
          {isAdmin && ` ${t('collections.emptyHintAdmin')}`}
        </EmptyState>
      ) : (
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          {q.data.map((c) => (
            <Link key={c.id} to={`/collections/${c.id}`} className="group block focus-visible:outline-none">
              <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent">
                <Artwork path={c.posterPath} title={c.name} />
                <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-ink backdrop-blur">{c.itemCount}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{c.name}</p>
              <p className="text-xs text-faint">{c.kind === 'manual' ? itemCountLabel(c.itemCount) : t('browse.movieCount', { count: c.itemCount })}</p>
            </Link>
          ))}
        </div>
      )}
      <Modal title={t('collections.new')} open={creating} onClose={() => setCreating(false)}>
        {creating && <CollectionForm onDone={(c) => {
              setCreating(false);
              if (c) navigate(`/collections/${c.id}`);
            }} />}
      </Modal>
    </div>
  );
}

export function CollectionPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const q = useQuery({ queryKey: ['collection', id], queryFn: () => api.get<CollectionDetail>(`/api/collections/${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['collection', id] });
    void qc.invalidateQueries({ queryKey: ['collections'] });
  };
  const remove = useMutation({
    mutationFn: (item: Card) => api.del(`/api/collections/${id}/items/${item.type}/${item.id}`),
    onSuccess: refresh,
    onError: (err) => toast.error(err),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/collections/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] });
      toast.success(t('collections.deleted'));
      navigate('/collections', { replace: true });
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const editable = user?.role === 'admin' && c.kind === 'manual';

  return (
    <div>
      <DetailHero backdropPath={c.backdropPath} posterPath={c.posterPath} title={c.name}>
        <p className="text-sm text-muted">{c.kind === 'auto' ? t('collections.movieCollection') : t('collections.collection')}</p>
        <h1 className="mt-1 font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{c.name}</h1>
        <MetaList items={[itemCountLabel(c.itemCount)]} />
        {c.overview && <p className="mt-4 max-w-2xl text-ink/85">{c.overview}</p>}
        {editable && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{t('common.edit')}</Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>{t('common.delete')}</Button>
          </div>
        )}
      </DetailHero>

      <div className="px-4 sm:px-8">
        {c.items.length === 0 ? (
          <EmptyState icon={<Layers className="size-6" />} title={t('collections.itemsEmpty')}>
            {t('collections.itemsEmptyHint')}
          </EmptyState>
        ) : (
          <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {c.items.map((item) => (
              <div key={`${item.type}-${item.id}`} className="relative">
                <PosterCard item={item} />
                {editable && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(item)}
                    className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/70 text-ink backdrop-blur hover:bg-danger hover:text-bg"
                    aria-label={t('collections.removeItem', { name: item.title })}
                    title={t('collections.removeFrom')}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title={t('collections.edit')} open={editing} onClose={() => setEditing(false)}>
        {editing && <CollectionForm initial={c} onDone={() => {
              setEditing(false);
              refresh();
            }} />}
      </Modal>
      <ConfirmModal
        open={deleting}
        title={t('collections.deleteTitle')}
        confirmLabel={t('collections.delete')}
        danger
        loading={del.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
      >
        {t('collections.deleteText', { name: c.name })}
      </ConfirmModal>
    </div>
  );
}
