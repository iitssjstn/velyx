import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Pencil, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { episodeCode, formatClock, formatRelative, parseClock } from '../../lib/format';
import { Button } from '../../components/Button';
import { ConfirmModal, Modal } from '../../components/Modal';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

type Confidence = 'high' | 'medium' | 'low';

export interface SegmentStatus {
  enabled: boolean;
  state: 'idle' | 'running' | 'waiting' | 'disabled';
  waitingFor: 'playback' | 'scan' | null;
  running: { showId: number; showTitle: string; seasonNumber: number; done: number; total: number } | null;
  queuedSeasons: number;
  counts: { episodes: number; analyzed: number; intros: number; credits: number; pending: number; errors: number; manual: number; lowConfidence: number };
}

export interface SegmentOverview {
  status: SegmentStatus;
  shows: { id: number; title: string; episodes: number; analyzed: number; intros: number; credits: number; errors: number; manual: number; low: number }[];
  errors: { episodeId: number; error: string | null; detectedAt: number; showId: number; showTitle: string; seasonNumber: number; episodeNumber: number }[];
}

interface Part {
  start: number;
  end: number;
  confidence: Confidence | null;
  /** Where it was found: chapter markers, the picture, recurring audio or by hand. */
  source?: 'chapters' | 'video' | 'audio' | 'manual' | null;
}

const SOURCE_LABEL = { chapters: 'chapters', video: 'picture', audio: 'audio', manual: 'by hand' } as const;

interface EpisodeSegmentsView {
  status: 'analyzed' | 'error';
  error: string | null;
  intro: Part | null;
  credits: Part | null;
  postCredits: Part | null;
  manual: boolean;
  detectedAt: number;
}

interface ShowSegments {
  show: { id: number; title: string };
  seasons: { seasonNumber: number; episodes: { id: number; episodeNumber: number; title: string | null; duration: number | null; eligible: boolean; segments: EpisodeSegmentsView | null }[] }[];
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low — not used' };

function statusLine(s: SegmentStatus): string {
  if (s.state === 'disabled') return 'Detection is turned off.';
  if (s.state === 'waiting') return s.waitingFor === 'playback' ? 'Waiting: someone is watching. Detection continues when playback ends.' : 'Waiting for the library scan to finish.';
  if (s.state === 'running' && s.running) return `Analysing ${s.running.showTitle}, season ${s.running.seasonNumber} (${s.running.done} of ${s.running.total} episodes read)${s.queuedSeasons ? ` · ${s.queuedSeasons} more season${s.queuedSeasons === 1 ? '' : 's'} queued` : ''}.`;
  return s.counts.pending ? `${s.counts.pending.toLocaleString()} episodes are waiting to be analysed.` : 'Up to date.';
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-display text-xl font-semibold tabular-nums ${tone === 'amber' && value > 0 ? 'text-amber' : value === 0 ? 'text-faint' : ''}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function PartLabel({ part, empty = '—' }: { part: Part | null; empty?: string }) {
  if (!part) return <span className="text-faint">{empty}</span>;
  return (
    <span className={part.confidence === 'low' ? 'text-faint line-through decoration-faint/60' : ''} title={part.confidence ? `Confidence: ${CONFIDENCE_LABEL[part.confidence]}` : undefined}>
      <span className="tabular-nums">{formatClock(part.start)}–{formatClock(part.end)}</span>
      {part.confidence && part.confidence !== 'high' && <span className={`ml-1.5 text-xs ${part.confidence === 'low' ? 'text-amber no-underline' : 'text-muted'}`}>{part.confidence}</span>}
      {part.source && part.source !== 'manual' && <span className="ml-1.5 text-xs text-faint">{SOURCE_LABEL[part.source]}</span>}
    </span>
  );
}

/** Edits the times of one episode; an empty pair means "none". */
function EditModal({ episode, onClose }: { episode: ShowSegments['seasons'][number]['episodes'][number]; onClose: () => void }) {
  const qc = useQueryClient();
  const s = episode.segments;
  const init = (p: Part | null | undefined) => ({ start: p ? formatClock(p.start) : '', end: p ? formatClock(p.end) : '' });
  const [values, setValues] = useState({ intro: init(s?.intro), credits: init(s?.credits), postCredits: init(s?.postCredits) });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, { start: number; end: number } | null>) => api.put(`/api/admin/segments/episodes/${episode.id}`, body),
    onSuccess: () => {
      toast.success('Saved. Automatic detection will not change this episode.');
      void qc.invalidateQueries({ queryKey: ['admin', 'segments'] });
      onClose();
    },
    onError: (err) => toast.error(err),
  });
  const submit = () => {
    const body: Record<string, { start: number; end: number } | null> = {};
    for (const key of ['intro', 'credits', 'postCredits'] as const) {
      const v = values[key];
      if (!v.start.trim() && !v.end.trim()) {
        body[key] = null;
        continue;
      }
      const start = parseClock(v.start);
      const end = parseClock(v.end);
      if (start === null || end === null) return setProblem('Enter times like 1:05 or 0:01:05.');
      if (end <= start) return setProblem('Each end must be after its start.');
      body[key] = { start, end };
    }
    setProblem(null);
    save.mutate(body);
  };
  const row = (key: 'intro' | 'credits' | 'postCredits', label: string) => (
    <fieldset className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-sm">{label}</span>
      <input aria-label={`${label} start`} className="input" placeholder="start" value={values[key].start} onChange={(e) => setValues({ ...values, [key]: { ...values[key], start: e.target.value } })} />
      <input aria-label={`${label} end`} className="input" placeholder="end" value={values[key].end} onChange={(e) => setValues({ ...values, [key]: { ...values[key], end: e.target.value } })} />
    </fieldset>
  );
  return (
    <Modal title={`Episode ${episode.episodeNumber}${episode.title ? ` — ${episode.title}` : ''}`} open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Times as minutes:seconds{episode.duration ? ` (the episode is ${formatClock(episode.duration)} long)` : ''}. Leave both fields empty for “none”. A post-credits scene is never skipped.</p>
        {row('intro', 'Intro')}
        {row('credits', 'Credits')}
        {row('postCredits', 'Post-credits')}
        {problem && <p className="text-sm text-danger">{problem}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={save.isPending}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShowDetail({ showId, onBack }: { showId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'segments', 'show', showId], queryFn: () => api.get<ShowSegments>(`/api/admin/segments/shows/${showId}`) });
  const [editing, setEditing] = useState<ShowSegments['seasons'][number]['episodes'][number] | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'segments'] });
  const analyze = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ queued: number }>('/api/admin/segments/analyze', body),
    onSuccess: (r) => {
      toast.success(r.queued ? `${r.queued} episode${r.queued === 1 ? '' : 's'} will be analysed again.` : 'Nothing to analyse (manual corrections are kept).');
      done();
    },
    onError: (err) => toast.error(err),
  });
  const reset = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/segments/episodes/${id}`),
    onSuccess: () => {
      toast.success('Correction removed. The episode is analysed again automatically.');
      done();
    },
    onError: (err) => toast.error(err),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section className="space-y-6" aria-labelledby="segments-show">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="grid size-9 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink" aria-label="All shows">
            <ChevronLeft className="size-5" />
          </button>
          <h2 id="segments-show" className="font-display text-xl font-semibold">
            <Link to={`/shows/${showId}`} className="hover:text-accent">{q.data.show.title}</Link>
          </h2>
        </div>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => analyze.mutate({ scope: 'show', showId })} loading={analyze.isPending}>Analyse show again</Button>
      </div>
      {q.data.seasons.map((season) => (
        <div key={season.seasonNumber} className="panel p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">{season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}</h3>
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => analyze.mutate({ scope: 'season', showId, seasonNumber: season.seasonNumber })}>Analyse season again</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-normal">Episode</th>
                  <th className="py-2 pr-3 font-normal">Intro</th>
                  <th className="py-2 pr-3 font-normal">Credits</th>
                  <th className="py-2 pr-3 font-normal">After credits</th>
                  <th className="py-2 font-normal"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {season.episodes.map((e) => {
                  const s = e.segments;
                  return (
                    <tr key={e.id}>
                      <td className="py-2 pr-3">
                        <span className="tabular-nums text-muted">E{String(e.episodeNumber).padStart(2, '0')}</span> <span className="ml-1">{e.title ?? ''}</span>
                        {s?.manual && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">manual</span>}
                      </td>
                      {!s ? (
                        <td colSpan={3} className="py-2 pr-3 text-faint">{e.eligible ? 'Not analysed yet' : 'No file of more than a minute to analyse'}</td>
                      ) : s.status === 'error' ? (
                        <td colSpan={3} className="py-2 pr-3 text-danger">{s.error ?? 'Could not be analysed'}</td>
                      ) : (
                        <>
                          <td className="py-2 pr-3"><PartLabel part={s.intro} empty="none found" /></td>
                          <td className="py-2 pr-3"><PartLabel part={s.credits} empty="none found" /></td>
                          <td className="py-2 pr-3"><PartLabel part={s.postCredits} /></td>
                        </>
                      )}
                      <td className="py-2 text-right whitespace-nowrap">
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => setEditing(e)} aria-label={`Edit episode ${e.episodeNumber}`} title="Edit times">
                          <Pencil className="size-4" />
                        </button>
                        {s?.manual ? (
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => reset.mutate(e.id)} aria-label={`Remove correction of episode ${e.episodeNumber}`} title="Remove correction (detect automatically)">
                            <Trash2 className="size-4" />
                          </button>
                        ) : (
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => analyze.mutate({ scope: 'episode', episodeId: e.id })} aria-label={`Analyse episode ${e.episodeNumber} again`} title="Analyse again">
                            <RotateCcw className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {editing && <EditModal episode={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

export function SegmentsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const showId = Number(params.get('show')) || null;
  const [confirmAll, setConfirmAll] = useState(false);
  const q = useQuery({
    queryKey: ['admin', 'segments'],
    queryFn: () => api.get<SegmentOverview>('/api/admin/segments'),
    // Only while there is work in progress; an idle page does not poll.
    refetchInterval: (query) => (query.state.data && ['running', 'waiting'].includes(query.state.data.status.state) ? 5000 : false),
  });
  const all = useMutation({
    mutationFn: () => api.post<{ queued: number }>('/api/admin/segments/analyze', { scope: 'all' }),
    onSuccess: (r) => {
      toast.success(`${r.queued.toLocaleString()} episodes will be analysed again.`);
      setConfirmAll(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'segments'] });
    },
    onError: (err) => toast.error(err),
  });

  if (showId) return <ShowDetail showId={showId} onBack={() => setParams({}, { replace: true })} />;
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { status, shows, errors } = q.data;
  const c = status.counts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          Velyx finds intros by comparing the sound of episodes in the same season, and end credits by recognising text on a dark background in the picture (or recurring credits music). Chapters named Intro or Credits are used when a file has them. Everything runs on this server, one episode at a time, and never while someone is watching or a scan runs. Only high and medium confidence results get a skip button.
        </p>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} disabled={!status.enabled} onClick={() => setConfirmAll(true)}>Analyse everything again</Button>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${status.state === 'disabled' ? 'border-amber/30 bg-amber/5' : 'border-line bg-raised/50'}`} role="status">
        <SkipForward className="size-4 shrink-0 text-muted" />
        <p className="flex-1">{statusLine(status)}</p>
        {status.state === 'disabled' && <Link to="/admin/server" className="text-accent underline-offset-4 hover:underline">Server settings</Link>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Episodes" value={c.episodes} />
        <Stat label="Analysed" value={c.analyzed} />
        <Stat label="Intros found" value={c.intros} />
        <Stat label="Credits found" value={c.credits} />
        <Stat label="Waiting" value={c.pending} />
        <Stat label="Errors" value={c.errors} tone="amber" />
        <Stat label="Low confidence" value={c.lowConfidence} />
        <Stat label="Corrected by hand" value={c.manual} />
      </div>

      {shows.length === 0 ? (
        <EmptyState icon={<SkipForward className="size-6" />} title="No TV shows yet">Intros and credits are detected for episodes in TV libraries.</EmptyState>
      ) : (
        <section aria-labelledby="segments-shows">
          <h2 id="segments-shows" className="mb-3 font-display text-lg font-semibold">Shows</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal">Show</th>
                  <th className="px-3 py-2 text-right font-normal">Episodes</th>
                  <th className="px-3 py-2 text-right font-normal">Intros</th>
                  <th className="px-3 py-2 text-right font-normal">Credits</th>
                  <th className="px-4 py-2 text-right font-normal">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {shows.map((s) => (
                  <tr key={s.id} className="hover:bg-raised/40">
                    <td className="px-4 py-2">
                      <button type="button" className="text-left font-medium hover:text-accent" onClick={() => setParams({ show: String(s.id) })}>{s.title}</button>
                      {s.analyzed + s.errors < s.episodes && <span className="ml-2 text-xs text-faint">{s.episodes - s.analyzed - s.errors} waiting</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.episodes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.intros}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.credits}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${s.errors ? 'text-amber' : 'text-faint'}`}>{s.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <section aria-labelledby="segments-errors">
          <h2 id="segments-errors" className="mb-3 font-display text-lg font-semibold">Errors</h2>
          <ul className="panel divide-y divide-line/50 text-sm">
            {errors.map((e) => (
              <li key={e.episodeId} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                <button type="button" className="font-medium hover:text-accent" onClick={() => setParams({ show: String(e.showId) })}>
                  {e.showTitle} · {episodeCode(e.seasonNumber, e.episodeNumber)}
                </button>
                <span className="flex-1 break-words text-danger">{e.error}</span>
                <span className="text-xs text-faint">{formatRelative(e.detectedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmModal
        open={confirmAll}
        title="Analyse every episode again?"
        confirmLabel="Analyse again"
        onConfirm={() => all.mutate()}
        onClose={() => setConfirmAll(false)}
        loading={all.isPending}
      >
        All automatic results are redone in the background, one season at a time. Manual corrections are kept. This can take a while on large libraries.
      </ConfirmModal>
    </div>
  );
}
