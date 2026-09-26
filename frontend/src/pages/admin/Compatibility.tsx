import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MonitorPlay } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { toast } from '../../components/Toast';

type Verdict = 'direct' | 'remux' | 'browser-dependent' | 'incompatible' | 'unknown';

export interface LibraryCompatibility {
  id: number;
  name: string;
  type: 'movies' | 'shows';
  files: number;
  verdicts: Record<Verdict, number>;
  issues: { label: string; count: number }[];
  notAnalyzed: number;
  health: { probeErrors: number; unmatched: number };
}

interface Report {
  libraries: LibraryCompatibility[];
  analysis: { running: boolean; done: number; total: number; failed: number };
}

export const VERDICTS: { key: Verdict; label: string; hint: string; color: string }[] = [
  { key: 'direct', label: 'Direct Play', hint: 'Plays as-is in current browsers', color: 'bg-ok' },
  { key: 'remux', label: 'Remux', hint: 'Audio or container converted on the fly (light)', color: 'bg-accent' },
  { key: 'browser-dependent', label: 'Depends on browser', hint: 'HEVC: Safari, and Chrome/Edge with hardware support', color: 'bg-amber' },
  { key: 'incompatible', label: 'Needs transcoding', hint: 'Browsers cannot decode the video', color: 'bg-danger' },
  { key: 'unknown', label: 'Not analysed', hint: 'FFprobe could not read the file', color: 'bg-line' },
];

export function LibraryCompatibilityCard({ lib }: { lib: LibraryCompatibility }) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">{lib.name}</h2>
        <span className="text-sm text-muted">{lib.files.toLocaleString()} files</span>
      </div>
      {lib.files > 0 && (
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
          {VERDICTS.map((v) => (lib.verdicts[v.key] ? <div key={v.key} className={v.color} style={{ width: `${(lib.verdicts[v.key] / lib.files) * 100}%` }} /> : null))}
        </div>
      )}
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {VERDICTS.filter((v) => v.key !== 'unknown' || lib.verdicts.unknown > 0).map((v) => (
          <div key={v.key} className="flex items-start gap-2" title={v.hint}>
            <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${v.color}`} />
            <dt className="flex-1">
              {v.label}
              <span className="block text-xs text-faint">{v.hint}</span>
            </dt>
            <dd className="tabular-nums">{lib.verdicts[v.key].toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {lib.issues.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium">Common reasons</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {lib.issues.map((i) => (
              <li key={i.label} className="rounded-full bg-raised px-3 py-1 text-xs text-ink/85">
                {i.label} <span className="text-muted">· {i.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(lib.health.probeErrors > 0 || lib.health.unmatched > 0) && (
        <p className="mt-4 text-sm text-amber">
          {[lib.health.probeErrors ? `${lib.health.probeErrors} unreadable ${lib.health.probeErrors === 1 ? 'file' : 'files'}` : null, lib.health.unmatched ? `${lib.health.unmatched} without metadata` : null]
            .filter(Boolean)
            .join(' · ')}{' '}
          — <Link to={lib.health.unmatched ? '/admin/metadata' : '/admin/libraries'} className="underline underline-offset-4">review</Link>
        </p>
      )}
    </section>
  );
}

export function CompatibilityPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'compatibility'],
    queryFn: () => api.get<Report>('/api/admin/compatibility'),
    refetchInterval: (query) => (query.state.data?.analysis.running ? 5000 : false),
  });
  const analyze = useMutation({
    mutationFn: () => api.post<{ analysis: Report['analysis'] }>('/api/admin/compatibility/analyze'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'compatibility'] }),
    onError: (err) => toast.error(err),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { libraries, analysis } = q.data;
  const notAnalyzed = libraries.reduce((n, l) => n + l.notAnalyzed, 0);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        How well your media plays in a typical current browser, based on the information Velyx already stored while scanning. Velyx does not transcode video, so files marked “Needs transcoding” only play on devices that decode them natively.
      </p>
      {(notAnalyzed > 0 || analysis.running) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3 text-sm">
          <p>
            {analysis.running
              ? `Analysing files… ${analysis.done.toLocaleString()} of ${analysis.total.toLocaleString()}`
              : `${notAnalyzed.toLocaleString()} ${notAnalyzed === 1 ? 'file was' : 'files were'} scanned before bit depth and HDR were recorded. They are analysed when first played, or all at once here (one file at a time).`}
          </p>
          {!analysis.running && <Button variant="secondary" size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending}>Analyse now</Button>}
        </div>
      )}
      {libraries.length === 0 ? (
        <EmptyState icon={<MonitorPlay className="size-6" />} title="No libraries yet" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {libraries.map((l) => (
            <LibraryCompatibilityCard key={l.id} lib={l} />
          ))}
        </div>
      )}
    </div>
  );
}
