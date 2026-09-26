import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { CollectionRef, CollectionSummary } from '../lib/types';
import { CollectionForm } from '../pages/Collections';
import { Modal } from './Modal';
import { Spinner } from './States';
import { toast } from './Toast';

/** Admin modal: tick the manual collections a movie or show belongs to. */
export function CollectionPicker({ type, id, current, onClose }: { type: 'movie' | 'show'; id: number; current: CollectionRef[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [member, setMember] = useState(() => new Set(current.filter((c) => c.kind === 'manual').map((c) => c.id)));
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['collections'], queryFn: () => api.get<CollectionSummary[]>('/api/collections') });
  const toggle = useMutation({
    mutationFn: ({ collectionId, add }: { collectionId: number; add: boolean }) =>
      add
        ? api.post(`/api/collections/${collectionId}/items`, type === 'movie' ? { movieId: id } : { showId: id })
        : api.del(`/api/collections/${collectionId}/items/${type}/${id}`),
    onMutate: ({ collectionId, add }) =>
      setMember((prev) => {
        const next = new Set(prev);
        if (add) next.add(collectionId);
        else next.delete(collectionId);
        return next;
      }),
    onError: (err, { collectionId, add }) => {
      setMember((prev) => {
        const next = new Set(prev);
        if (add) next.delete(collectionId);
        else next.add(collectionId);
        return next;
      });
      toast.error(err);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] });
      void qc.invalidateQueries({ queryKey: ['collection'] });
      void qc.invalidateQueries({ queryKey: [type, id] });
    },
  });
  const manual = q.data?.filter((c) => c.kind === 'manual') ?? [];

  return (
    <Modal title={creating ? 'New collection' : 'Add to collection'} open onClose={onClose}>
      {creating ? (
        <CollectionForm
          onDone={(c) => {
            setCreating(false);
            if (c) toggle.mutate({ collectionId: c.id, add: true });
          }}
        />
      ) : (
        <div className="space-y-4">
          {q.isLoading ? (
            <Spinner className="mx-auto size-6" />
          ) : manual.length === 0 ? (
            <p className="text-sm text-muted">You have no collections yet.</p>
          ) : (
            <ul className="divide-y divide-line/60 rounded-xl border border-line">
              {manual.map((c) => {
                const on = member.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ collectionId: c.id, add: !on })}
                      aria-pressed={on}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised"
                    >
                      <span className={`grid size-5 place-items-center rounded border ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}>
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-faint">{c.itemCount}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-faint">Movie series from TMDB, like “The Matrix Collection”, are grouped automatically.</p>
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-muted hover:bg-raised hover:text-ink">
              <Plus className="size-4" /> New collection
            </button>
            <button type="button" onClick={onClose} className="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink">
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
