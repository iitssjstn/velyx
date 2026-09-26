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
import { intlLocale, t, useT, type MessageKey } from '../../i18n';

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

const SOURCE_LABEL: Record<NonNullable<Part['source']>, MessageKey> = { chapters: 'segments.sources.chapters', video: 'segments.sources.video', audio: 'segments.sources.audio', manual: 'segments.sources.manual' };

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

const CONFIDENCE_LABEL: Record<Confidence, MessageKey> = { high: 'segments.confidence.high', medium: 'segments.confidence.medium', low: 'segments.confidence.lowNotUsed' };

/** Errors the detector stores as fixed phrases. */
const ERRORS: Record<string, MessageKey> = {
  'Not analysed': 'segments.errors.notAnalysed',
  'The file has no readable audio': 'segments.errors.noAudio',
  'Could not read the audio': 'segments.errors.readAudio',
};
const errorText = (e: string | null) => (e && ERRORS[e] ? t(ERRORS[e]) : e);

function statusLine(s: SegmentStatus): string {
  if (s.state === 'disabled') return t('segments.status.disabled');
  if (s.state === 'waiting') return s.waitingFor === 'playback' ? t('segments.status.waitingPlayback') : t('segments.status.waitingScan');
  if (s.state === 'running' && s.running) {
    const now = t('segments.status.running', { show: s.running.showTitle, season: s.running.seasonNumber, done: s.running.done, total: s.running.total });
    return s.queuedSeasons ? `${now} · ${t('segments.status.queued', { count: s.queuedSeasons })}` : now;
  }
  return s.counts.pending ? t('segments.status.pending', { count: s.counts.pending }) : t('segments.status.upToDate');
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-display text-xl font-semibold tabular-nums ${tone === 'amber' && value > 0 ? 'text-amber' : value === 0 ? 'text-faint' : ''}`}>{value.toLocaleString(intlLocale())}</p>
    </div>
  );
}

function PartLabel({ part, empty = '—' }: { part: Part | null; empty?: string }) {
  useT();
  if (!part) return <span className="text-faint">{empty}</span>;
  return (
    <span className={part.confidence === 'low' ? 'text-faint line-through decoration-faint/60' : ''} title={part.confidence ? t('segments.confidenceTitle', { level: t(CONFIDENCE_LABEL[part.confidence]) }) : undefined}>
      <span className="tabular-nums">{formatClock(part.start)}–{formatClock(part.end)}</span>
      {part.confidence && part.confidence !== 'high' && <span className={`ml-1.5 text-xs ${part.confidence === 'low' ? 'text-amber no-underline' : 'text-muted'}`}>{t(`segments.confidence.${part.confidence}`)}</span>}
      {part.source && part.source !== 'manual' && <span className="ml-1.5 text-xs text-faint">{t(SOURCE_LABEL[part.source])}</span>}
    </span>
  );
}

/** Edits the times of one episode; an empty pair means "none". */
function EditModal({ episode, onClose }: { episode: ShowSegments['seasons'][number]['episodes'][number]; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const s = episode.segments;
  const init = (p: Part | null | undefined) => ({ start: p ? formatClock(p.start) : '', end: p ? formatClock(p.end) : '' });
  const [values, setValues] = useState({ intro: init(s?.intro), credits: init(s?.credits), postCredits: init(s?.postCredits) });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, { start: number; end: number } | null>) => api.put(`/api/admin/segments/episodes/${episode.id}`, body),
    onSuccess: () => {
      toast.success(t('segments.saved'));
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
      if (start === null || end === null) return setProblem(t('segments.enterTimes'));
      if (end <= start) return setProblem(t('segments.endAfterStart'));
      body[key] = { start, end };
    }
    setProblem(null);
    save.mutate(body);
  };
  const row = (key: 'intro' | 'credits' | 'postCredits', label: string) => (
    <fieldset className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-sm">{label}</span>
      <input aria-label={t('segments.startOf', { label })} className="input" placeholder={t('segments.start')} value={values[key].start} onChange={(e) => setValues({ ...values, [key]: { ...values[key], start: e.target.value } })} />
      <input aria-label={t('segments.endOf', { label })} className="input" placeholder={t('segments.end')} value={values[key].end} onChange={(e) => setValues({ ...values, [key]: { ...values[key], end: e.target.value } })} />
    </fieldset>
  );
  return (
    <Modal title={`${t('series.episode', { n: episode.episodeNumber })}${episode.title ? ` — ${episode.title}` : ''}`} open onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{episode.duration ? t('segments.editHintLength', { length: formatClock(episode.duration) }) : t('segments.editHint')}</p>
        {row('intro', t('segments.intro'))}
        {row('credits', t('segments.credits'))}
        {row('postCredits', t('segments.postCredits'))}
        {problem && <p className="text-sm text-danger">{problem}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShowDetail({ showId, onBack }: { showId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'segments', 'show', showId], queryFn: () => api.get<ShowSegments>(`/api/admin/segments/shows/${showId}`) });
  const [editing, setEditing] = useState<ShowSegments['seasons'][number]['episodes'][number] | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'segments'] });
  const analyze = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ queued: number }>('/api/admin/segments/analyze', body),
    onSuccess: (r) => {
      toast.success(r.queued ? t('segments.queuedAgain', { count: r.queued }) : t('segments.nothingToAnalyse'));
      done();
    },
    onError: (err) => toast.error(err),
  });
  const reset = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/segments/episodes/${id}`),
    onSuccess: () => {
      toast.success(t('segments.correctionRemoved'));
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
          <button type="button" onClick={onBack} className="grid size-9 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink" aria-label={t('segments.allShows')}>
            <ChevronLeft className="size-5" />
          </button>
          <h2 id="segments-show" className="font-display text-xl font-semibold">
            <Link to={`/shows/${showId}`} className="hover:text-accent">{q.data.show.title}</Link>
          </h2>
        </div>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => analyze.mutate({ scope: 'show', showId })} loading={analyze.isPending}>{t('segments.analyseShow')}</Button>
      </div>
      {q.data.seasons.map((season) => (
        <div key={season.seasonNumber} className="panel p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">{season.seasonNumber === 0 ? t('series.specials') : t('series.season', { n: season.seasonNumber })}</h3>
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => analyze.mutate({ scope: 'season', showId, seasonNumber: season.seasonNumber })}>{t('segments.analyseSeason')}</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-normal">{t('segments.episode')}</th>
                  <th className="py-2 pr-3 font-normal">{t('segments.intro')}</th>
                  <th className="py-2 pr-3 font-normal">{t('segments.credits')}</th>
                  <th className="py-2 pr-3 font-normal">{t('segments.afterCredits')}</th>
                  <th className="py-2 font-normal"><span className="sr-only">{t('segments.actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {season.episodes.map((e) => {
                  const s = e.segments;
                  return (
                    <tr key={e.id}>
                      <td className="py-2 pr-3">
                        <span className="tabular-nums text-muted">E{String(e.episodeNumber).padStart(2, '0')}</span> <span className="ml-1">{e.title ?? ''}</span>
                        {s?.manual && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">{t('segments.manual')}</span>}
                      </td>
                      {!s ? (
                        <td colSpan={3} className="py-2 pr-3 text-faint">{e.eligible ? t('segments.notAnalysedYet') : t('segments.noFile')}</td>
                      ) : s.status === 'error' ? (
                        <td colSpan={3} className="py-2 pr-3 text-danger">{errorText(s.error) ?? t('segments.couldNotAnalyse')}</td>
                      ) : (
                        <>
                          <td className="py-2 pr-3"><PartLabel part={s.intro} empty={t('segments.noneFound')} /></td>
                          <td className="py-2 pr-3"><PartLabel part={s.credits} empty={t('segments.noneFound')} /></td>
                          <td className="py-2 pr-3"><PartLabel part={s.postCredits} /></td>
                        </>
                      )}
                      <td className="py-2 text-right whitespace-nowrap">
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => setEditing(e)} aria-label={t('segments.editEpisode', { n: e.episodeNumber })} title={t('segments.editTimes')}>
                          <Pencil className="size-4" />
                        </button>
                        {s?.manual ? (
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => reset.mutate(e.id)} aria-label={t('segments.removeCorrectionOf', { n: e.episodeNumber })} title={t('segments.removeCorrection')}>
                            <Trash2 className="size-4" />
                          </button>
                        ) : (
                          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" onClick={() => analyze.mutate({ scope: 'episode', episodeId: e.id })} aria-label={t('segments.analyseEpisode', { n: e.episodeNumber })} title={t('segments.analyseAgain')}>
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
  const { t } = useT();
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
      toast.success(t('segments.queuedAgain', { count: r.queued }));
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
          {t('segments.intro_text')}
        </p>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} disabled={!status.enabled} onClick={() => setConfirmAll(true)}>{t('segments.analyseEverything')}</Button>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${status.state === 'disabled' ? 'border-amber/30 bg-amber/5' : 'border-line bg-raised/50'}`} role="status">
        <SkipForward className="size-4 shrink-0 text-muted" />
        <p className="flex-1">{statusLine(status)}</p>
        {status.state === 'disabled' && <Link to="/admin/server" className="text-accent underline-offset-4 hover:underline">{t('audit.groups.serverSettings')}</Link>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('series.episodes')} value={c.episodes} />
        <Stat label={t('segments.stats.analysed')} value={c.analyzed} />
        <Stat label={t('segments.stats.intros')} value={c.intros} />
        <Stat label={t('segments.stats.credits')} value={c.credits} />
        <Stat label={t('segments.stats.waiting')} value={c.pending} />
        <Stat label={t('segments.stats.errors')} value={c.errors} tone="amber" />
        <Stat label={t('segments.stats.lowConfidence')} value={c.lowConfidence} />
        <Stat label={t('segments.stats.manual')} value={c.manual} />
      </div>

      {shows.length === 0 ? (
        <EmptyState icon={<SkipForward className="size-6" />} title={t('browse.noShows')}>{t('segments.noShowsText')}</EmptyState>
      ) : (
        <section aria-labelledby="segments-shows">
          <h2 id="segments-shows" className="mb-3 font-display text-lg font-semibold">{t('nav.tvShows')}</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal">{t('metadata.show')}</th>
                  <th className="px-3 py-2 text-right font-normal">{t('series.episodes')}</th>
                  <th className="px-3 py-2 text-right font-normal">{t('segments.intros')}</th>
                  <th className="px-3 py-2 text-right font-normal">{t('segments.credits')}</th>
                  <th className="px-4 py-2 text-right font-normal">{t('segments.stats.errors')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {shows.map((s) => (
                  <tr key={s.id} className="hover:bg-raised/40">
                    <td className="px-4 py-2">
                      <button type="button" className="text-left font-medium hover:text-accent" onClick={() => setParams({ show: String(s.id) })}>{s.title}</button>
                      {s.analyzed + s.errors < s.episodes && <span className="ml-2 text-xs text-faint">{t('segments.waitingCount', { count: s.episodes - s.analyzed - s.errors })}</span>}
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
          <h2 id="segments-errors" className="mb-3 font-display text-lg font-semibold">{t('segments.stats.errors')}</h2>
          <ul className="panel divide-y divide-line/50 text-sm">
            {errors.map((e) => (
              <li key={e.episodeId} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                <button type="button" className="font-medium hover:text-accent" onClick={() => setParams({ show: String(e.showId) })}>
                  {e.showTitle} · {episodeCode(e.seasonNumber, e.episodeNumber)}
                </button>
                <span className="flex-1 break-words text-danger">{errorText(e.error)}</span>
                <span className="text-xs text-faint">{formatRelative(e.detectedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmModal
        open={confirmAll}
        title={t('segments.allTitle')}
        confirmLabel={t('segments.analyseAgain')}
        onConfirm={() => all.mutate()}
        onClose={() => setConfirmAll(false)}
        loading={all.isPending}
      >
        {t('segments.allText')}
      </ConfirmModal>
    </div>
  );
}
