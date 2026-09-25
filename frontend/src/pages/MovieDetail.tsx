import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Eye, Play, RotateCcw, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatClock, formatDate, formatRuntime, progressFraction, resolutionLabel } from '../lib/format';
import type { MovieDetail } from '../lib/types';
import { DetailHero, MetaList } from '../components/DetailHero';
import { FavoriteButton } from '../components/FavoriteButton';
import { AdminItemMenu } from '../components/AdminItemMenu';
import { CastRow } from '../components/People';
import { MediaInfo } from '../components/MediaInfo';
import { ProgressBar } from '../components/ProgressBar';
import { ErrorState, PageLoader } from '../components/States';
import { toast } from '../components/Toast';

export function MoviePage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [fileIdx, setFileIdx] = useState(0);
  const q = useQuery({ queryKey: ['movie', id], queryFn: () => api.get<MovieDetail>(`/api/movies/${id}`) });
  const watched = useMutation({
    mutationFn: (value: boolean) => api.post('/api/progress/watched', { movieId: id, watched: value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['movie', id] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['movies'] });
    },
    onError: (err) => toast.error(err),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  const file = m.files[fileIdx] ?? m.files[0];
  const resume = m.progress && !m.progress.completed && m.progress.positionSec >= 30 ? m.progress : null;
  const director = m.director ?? m.crew.find((c) => c.role === 'Director')?.name;
  const writers = m.crew.filter((c) => c.role === 'Screenplay' || c.role === 'Writer').map((c) => c.name);

  return (
    <div>
      <DetailHero backdropPath={m.backdropPath} posterPath={m.posterPath} title={m.title}>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl">{m.title}</h1>
        {m.tagline && <p className="mt-2 font-display text-lg text-ink/70 italic">{m.tagline}</p>}
        <MetaList
          items={[
            m.year,
            formatRuntime(m.runtime),
            m.rating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-amber text-amber" />
                {m.rating.toFixed(1)}
              </span>
            ) : null,
            file && resolutionLabel(file.width, file.height),
            m.progress?.completed && (
              <span className="inline-flex items-center gap-1 text-ok">
                <Check className="size-3.5" /> Watched
              </span>
            ),
          ]}
        />
        {m.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.genres.map((g) => (
              <Link key={g.id} to={`/movies?genre=${g.id}`} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-ink">
                {g.name}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {file ? (
            <>
              <Link to={`/play/movie/${m.id}${m.files.length > 1 ? `?file=${file.id}` : ''}`} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-bg hover:bg-white">
                <Play className="size-5 fill-current" />
                {resume ? `Resume from ${formatClock(resume.positionSec)}` : 'Play'}
              </Link>
              {resume && (
                <Link to={`/play/movie/${m.id}?t=0${m.files.length > 1 ? `&file=${file.id}` : ''}`} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink/10 px-5 hover:bg-ink/20" title="Play from the beginning">
                  <RotateCcw className="size-4" /> From start
                </Link>
              )}
            </>
          ) : (
            <p className="text-sm text-danger">No playable file — rescan the library.</p>
          )}
          <FavoriteButton type="movie" id={m.id} initial={m.favorite} />
          <button
            type="button"
            onClick={() => watched.mutate(!m.progress?.completed)}
            className={`grid size-12 place-items-center rounded-full border transition-colors ${m.progress?.completed ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-surface/70 text-muted hover:text-ink'}`}
            aria-label={m.progress?.completed ? 'Mark as unwatched' : 'Mark as watched'}
            title={m.progress?.completed ? 'Mark as unwatched' : 'Mark as watched'}
          >
            {m.progress?.completed ? <Check className="size-5" /> : <Eye className="size-5" />}
          </button>
          {user?.role === 'admin' && (
            <AdminItemMenu type="movie" id={m.id} query={m.match.parsedTitle} year={m.match.parsedYear} onMatched={(newId) => newId !== m.id && navigate(`/movies/${newId}`, { replace: true })} />
          )}
        </div>
        {resume && <ProgressBar value={progressFraction(resume)} className="mt-4 max-w-sm" />}
      </DetailHero>

      <div className="mt-10 grid gap-10 px-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          {m.overview ? <p className="max-w-3xl text-lg leading-relaxed text-ink/85">{m.overview}</p> : <p className="text-muted">No description available.</p>}
          <dl className="mt-6 grid max-w-3xl gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {director && (
              <div>
                <dt className="text-faint">Director</dt>
                <dd>{director}</dd>
              </div>
            )}
            {writers.length > 0 && (
              <div>
                <dt className="text-faint">Writing</dt>
                <dd>{writers.join(', ')}</dd>
              </div>
            )}
            {m.releaseDate && (
              <div>
                <dt className="text-faint">Released</dt>
                <dd>{formatDate(m.releaseDate)}</dd>
              </div>
            )}
            {m.originalTitle && m.originalTitle !== m.title && (
              <div>
                <dt className="text-faint">Original title</dt>
                <dd>{m.originalTitle}</dd>
              </div>
            )}
          </dl>
          {m.match.status === 'unmatched' && (
            <p className="mt-6 rounded-lg bg-amber/10 px-4 py-3 text-sm text-amber">
              Velyx could not identify this movie with confidence. {user?.role === 'admin' ? 'Use “Fix match” from the menu above.' : 'An administrator can fix the match.'}
            </p>
          )}
        </div>
        {m.files.length > 0 && (
          <aside className="panel h-fit p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Media info</h2>
              {m.files.length > 1 && (
                <select aria-label="Version" className="input h-8 w-auto py-0 text-xs" value={fileIdx} onChange={(e) => setFileIdx(Number(e.target.value))}>
                  {m.files.map((f, i) => (
                    <option key={f.id} value={i}>
                      {resolutionLabel(f.width, f.height) ?? f.fileName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {file && <MediaInfo file={file} />}
          </aside>
        )}
      </div>
      <CastRow cast={m.cast} />
    </div>
  );
}
