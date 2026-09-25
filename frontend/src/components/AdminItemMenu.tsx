import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, RefreshCw, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from './Toast';
import { FixMatchModal } from './FixMatchModal';

/** Admin-only actions for a movie or show: fix match and refresh metadata. */
export function AdminItemMenu({ type, id, query, year, onMatched }: { type: 'movie' | 'show'; id: number; query: string; year: number | null; onMatched?: (id: number) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const refresh = useMutation({
    mutationFn: () => api.post<{ result: string }>(`/api/admin/refresh/${type}/${id}`),
    onSuccess: (r) => {
      toast.success(r.result === 'matched' ? 'Metadata refreshed.' : 'No confident match found — use Fix match.');
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err),
  });
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="grid size-12 place-items-center rounded-full border border-line bg-surface/70 text-muted hover:text-ink"
        aria-label="More actions"
        aria-expanded={open}
      >
        {refresh.isPending ? <RefreshCw className="size-5 animate-spin" /> : <MoreHorizontal className="size-5" />}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-2xl sm:right-auto sm:left-0">
          <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-line" onClick={() => { setOpen(false); setFix(true); }}>
            <Wand2 className="size-4 text-muted" /> Fix match
          </button>
          <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-line" onClick={() => { setOpen(false); refresh.mutate(); }}>
            <RefreshCw className="size-4 text-muted" /> Refresh metadata
          </button>
        </div>
      )}
      {fix && <FixMatchModal open onClose={() => setFix(false)} type={type} id={id} initialQuery={query} initialYear={year} onMatched={onMatched} />}
    </div>
  );
}
