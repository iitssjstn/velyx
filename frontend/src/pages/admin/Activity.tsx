import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import type { ActiveStream, ActivityStats, HistoryEntry } from '../../lib/types';
import { Button } from '../../components/Button';
import { ErrorState, PageLoader, Spinner } from '../../components/States';
import { HistoryRow, StreamRow, formatWatched } from '../../components/ActiveStreams';
import { deviceName } from '../../lib/format';
import { intlLocale, t, useT, type MessageKey } from '../../i18n';

const RANGES: [number, MessageKey][] = [
  [7, 'activity.ranges.d7'],
  [30, 'activity.ranges.d30'],
  [90, 'activity.ranges.d90'],
  [365, 'activity.ranges.d365'],
];
const PAGE_SIZE = 50;

function hours(sec: number): string {
  return sec >= 36_000 ? t('activity.hours', { n: Math.round(sec / 3600) }) : formatWatched(sec);
}

/** "Mon 21 Sep", "week of 21 Sep" or "Sep 2026" for a timeline period. */
export function periodLabel(period: string, g: ActivityStats['granularity']): string {
  const [y, m, d] = period.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  if (g === 'month') return date.toLocaleDateString(intlLocale(), { month: 'short', year: 'numeric' });
  const day = date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
  return g === 'week' ? t('activity.weekOf', { day }) : date.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Timeline({ stats }: { stats: ActivityStats }) {
  const { t } = useT();
  const per = t(`activity.per.${stats.granularity}`);
  const max = Math.max(1, ...stats.timeline.map((p) => p.watchSec));
  const first = stats.timeline[0];
  const last = stats.timeline[stats.timeline.length - 1];
  return (
    <section className="panel p-5" aria-labelledby="activity-timeline">
      <h2 id="activity-timeline" className="font-display text-lg font-semibold">{per}</h2>
      <div className="mt-4 flex h-36 items-end gap-[2px]" role="img" aria-label={per}>
        {stats.timeline.map((p) => (
          <div
            key={p.period}
            className="group relative flex h-full flex-1 items-end"
            title={`${periodLabel(p.period, stats.granularity)}: ${hours(p.watchSec)} · ${t('activity.plays', { count: p.plays })}`}
          >
            <div className={`w-full rounded-t ${p.watchSec ? 'bg-accent/70 group-hover:bg-accent' : 'bg-line/60'}`} style={{ height: p.watchSec ? `${Math.max(3, (p.watchSec / max) * 100)}%` : '2px' }} />
          </div>
        ))}
      </div>
      {first && last && (
        <div className="mt-2 flex justify-between text-xs text-faint">
          <span>{periodLabel(first.period, stats.granularity)}</span>
          <span>{periodLabel(last.period, stats.granularity)}</span>
        </div>
      )}
    </section>
  );
}

function Modes({ stats }: { stats: ActivityStats }) {
  const { t } = useT();
  const { direct, remux, audioConverted } = stats.modes;
  const total = direct.plays + remux.plays;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <section className="panel p-5" aria-labelledby="activity-modes">
      <h2 id="activity-modes" className="font-display text-lg font-semibold">{t('activity.howItPlayed')}</h2>
      {total === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('activity.noPlays')}</p>
      ) : (
        <>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="bg-ok" style={{ width: `${pct(direct.plays)}%` }} />
            <div className="bg-accent" style={{ width: `${pct(remux.plays)}%` }} />
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-ok" aria-hidden />{t('playback.directPlay')}</dt>
              <dd className="tabular-nums text-muted">{direct.plays} · {pct(direct.plays)}%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-accent" aria-hidden />{t('playback.remux')}</dt>
              <dd className="tabular-nums text-muted">{remux.plays} · {pct(remux.plays)}%</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted">
              <dt>{t('activity.audioConverted')}</dt>
              <dd className="tabular-nums">{audioConverted}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-faint">{t('activity.neverTranscodes')}</p>
        </>
      )}
    </section>
  );
}

function TopList({ title, rows, empty }: { title: string; rows: { key: string; label: React.ReactNode; plays: number; watchSec: number }[]; empty: string }) {
  const { t } = useT();
  return (
    <section className="panel p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-2 text-sm">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right text-xs text-faint tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{t('activity.plays', { count: r.plays })} · {hours(r.watchSec)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function History() {
  const [params, setParams] = useSearchParams();
  const { t } = useT();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const userId = params.get('user');
  const kind = params.get('kind');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ id: number; username: string }[]>('/api/users') });
  const q = useQuery({
    queryKey: ['admin', 'activity', 'history', page, userId, kind],
    queryFn: () => api.get<{ total: number; items: HistoryEntry[] }>(`/api/admin/activity/history?page=${page}&limit=${PAGE_SIZE}${userId ? `&userId=${userId}` : ''}${kind ? `&kind=${kind}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / PAGE_SIZE));
  return (
    <section aria-labelledby="activity-history">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="activity-history" className="font-display text-lg font-semibold">{t('settings.tabs.history')}</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <select aria-label={t('activity.user')} value={userId ?? ''} onChange={(e) => set({ user: e.target.value || null, page: null })} className="h-9 rounded-lg border border-line bg-surface px-3">
            <option value="">{t('activity.everyone')}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <select aria-label={t('activity.type')} value={kind ?? ''} onChange={(e) => set({ kind: e.target.value || null, page: null })} className="h-9 rounded-lg border border-line bg-surface px-3">
            <option value="">{t('activity.moviesAndEpisodes')}</option>
            <option value="movie">{t('nav.movies')}</option>
            <option value="episode">{t('series.episodes')}</option>
          </select>
        </div>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10"><Spinner className="size-6" /></div>
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="panel px-4 py-8 text-center text-sm text-muted">{t('settings.history.empty')}</p>
      ) : (
        <ul className={`panel divide-y divide-line/50 ${q.isFetching ? 'opacity-60' : ''}`}>
          {q.data.items.map((h) => (
            <HistoryRow key={h.id} h={h} showUser />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="mr-2 text-muted">{t('common.pageOf', { page, pages })}</span>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} icon={<ChevronLeft className="size-4" />}>{t('common.previous')}</Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} icon={<ChevronRight className="size-4" />}>{t('common.next')}</Button>
        </div>
      )}
    </section>
  );
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const { t } = useT();
  const days = RANGES.some(([d]) => String(d) === params.get('days')) ? Number(params.get('days')) : 30;
  const q = useQuery({
    queryKey: ['admin', 'activity', days],
    queryFn: () => api.get<{ streams: ActiveStream[]; stats: ActivityStats }>(`/api/admin/activity?days=${days}`),
    placeholderData: keepPreviousData,
    // Refreshed only while someone is watching.
    refetchInterval: (query) => (query.state.data?.streams.length ? 10_000 : false),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { streams, stats } = q.data;
  const totals = stats.totals;
  return (
    <div className="space-y-6">
      <section className="panel p-5" aria-labelledby="activity-now">
        <div className="flex items-center justify-between gap-3">
          <h2 id="activity-now" className="font-display text-lg font-semibold">{t('activity.nowPlaying')}</h2>
          <span className="text-sm text-muted">{streams.length || t('activity.nobody')}</span>
        </div>
        {streams.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('dashboard.nobodyWatching')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/50">
            {streams.map((s) => (
              <StreamRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('activity.howCounted')}</p>
        <div className="flex rounded-lg bg-raised p-1 text-sm" role="group" aria-label={t('activity.period')}>
          {RANGES.map(([d, label]) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === days}
              onClick={() => setParams((p) => {
                const next = new URLSearchParams(p);
                next.set('days', String(d));
                return next;
              }, { replace: true })}
              className={`rounded-md px-3 py-1 transition ${d === days ? 'bg-surface text-ink shadow' : 'text-muted hover:text-ink'}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-5 ${q.isFetching ? 'opacity-70' : ''}`}>
        <Stat label={t('activity.watchTime')} value={hours(totals.watchSec)} />
        <Stat label={t('activity.playsLabel')} value={totals.plays.toLocaleString(intlLocale())} />
        <Stat label={t('nav.movies')} value={totals.movies.toLocaleString(intlLocale())} />
        <Stat label={t('series.episodes')} value={totals.episodes.toLocaleString(intlLocale())} />
        <Stat label={t('activity.activeUsers')} value={totals.users.toLocaleString(intlLocale())} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Timeline stats={stats} />
        <Modes stats={stats} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TopList title={t('activity.topMovies')} empty={t('activity.noMovies')} rows={stats.topMovies.map((m) => ({ key: `m${m.id}`, label: <Link to={`/movies/${m.id}`} className="hover:text-accent">{m.title}{m.subtitle ? <span className="text-muted"> ({m.subtitle})</span> : null}</Link>, plays: m.plays, watchSec: m.watchSec }))} />
        <TopList title={t('activity.topShows')} empty={t('activity.noEpisodes')} rows={stats.topShows.map((s) => ({ key: `s${s.id}`, label: <Link to={`/shows/${s.id}`} className="hover:text-accent">{s.title}</Link>, plays: s.plays, watchSec: s.watchSec }))} />
        <TopList title={t('admin.tabs.users')} empty={t('activity.nobodyWatched')} rows={stats.topUsers.map((u) => ({ key: u.username, label: u.username, plays: u.plays, watchSec: u.watchSec }))} />
        <TopList title={t('settings.account.devices')} empty={t('activity.nothingPlayed')} rows={stats.clients.map((c) => ({ key: c.device, label: deviceName(c.device), plays: c.plays, watchSec: c.watchSec }))} />
      </div>

      <History />
    </div>
  );
}
