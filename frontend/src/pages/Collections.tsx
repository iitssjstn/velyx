import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Card, CollectionDetail, CollectionSummary } from '../lib/types';
import { Artwork } from '../components/Artwork';
import { Button } from '../components/Button';
import { PosterCard } from '../components/Cards';
import { DetailHero, MetaList } from '../components/DetailHero';
import { ConfirmModal, Modal } from '../components/Modal';
import { EmptyState, ErrorState, PageLoader } from '../components/States';
import { toast } from '../components/Toast';

function itemCountLabel(n: number) {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/** Name + description form, used to create and to edit a manual collection. */
export function CollectionForm({ initial, onDone }: { initial?: CollectionSummary; onDone: (c?: CollectionSummary) => void }) {
  const qc = useQueryClient();
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
      toast.success(initial ? 'Collection updated.' : 'Collection created.');
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
        <label className="label" htmlFor="c-name">Name</label>
        <input id="c-name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas movies" />
      </div>
      <div>
        <label className="label" htmlFor="c-overview">Description</label>
        <textarea id="c-overview" className="input min-h-24 py-2" maxLength={2000} value={overview} onChange={(e) => setOverview(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" loading={m.isPending}>{initial ? 'Save' : 'Create collection'}</Button>
      </div>
    </form>
  );
}

export function CollectionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const isAdmin = user?.role === 'admin';
  return (
    <div className="px-4 pt-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Collections</h1>
        {isAdmin && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New collection
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<Layers className="size-6" />} title="No collections yet">
          Movie series such as “The Matrix Collection” appear here automatically once your library holds two or more of their movies.
          {isAdmin && ' You can also make your own collections.'}
        </EmptyState>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          {q.data.map((c) => (
            <Link key={c.id} to={`/collections/${c.id}`} className="group block focus-visible:outline-none">
              <div className="relative overflow-hidden rounded-[var(--radius-card)] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent">
                <Artwork path={c.posterPath} title={c.name} />
                <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-ink backdrop-blur">{c.itemCount}</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-ink/90 group-hover:text-ink">{c.name}</p>
              <p className="text-xs text-faint">{c.kind === 'manual' ? itemCountLabel(c.itemCount) : `${c.itemCount} movies`}</p>
            </Link>
          ))}
        </div>
      )}
      <Modal title="New collection" open={creating} onClose={() => setCreating(false)}>
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
      toast.success('Collection deleted.');
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
        <p className="text-sm text-muted">{c.kind === 'auto' ? 'Movie collection' : 'Collection'}</p>
        <h1 className="mt-1 font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{c.name}</h1>
        <MetaList items={[itemCountLabel(c.itemCount)]} />
        {c.overview && <p className="mt-4 max-w-2xl text-ink/85">{c.overview}</p>}
        {editable && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Delete</Button>
          </div>
        )}
      </DetailHero>

      <div className="px-4 sm:px-8">
        {c.items.length === 0 ? (
          <EmptyState icon={<Layers className="size-6" />} title="This collection is empty">
            Open a movie or show and choose “Add to collection” from the ⋯ menu.
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
                    aria-label={`Remove ${item.title} from this collection`}
                    title="Remove from collection"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title="Edit collection" open={editing} onClose={() => setEditing(false)}>
        {editing && <CollectionForm initial={c} onDone={() => {
              setEditing(false);
              refresh();
            }} />}
      </Modal>
      <ConfirmModal
        open={deleting}
        title="Delete collection?"
        confirmLabel="Delete collection"
        danger
        loading={del.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
      >
        “{c.name}” will be removed. The movies and shows in it stay in your library.
      </ConfirmModal>
    </div>
  );
}
