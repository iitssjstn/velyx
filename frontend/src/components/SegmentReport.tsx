import { useState } from 'react';
import { Modal } from './Modal';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatClock } from '../lib/format';
import type { EpisodeSegments } from '../lib/player';
import { useT } from '../i18n';

export type ReportKind = 'recap' | 'intro' | 'credits';
export type ReportProblem = 'starts-early' | 'starts-late' | 'ends-early' | 'ends-late' | 'not-there' | 'missing';

const KINDS: ReportKind[] = ['recap', 'intro', 'credits'];
const KIND_LABEL = { recap: 'player.reportKindRecap', intro: 'player.reportKindIntro', credits: 'player.reportKindCredits' } as const;
const PROBLEM_LABEL = {
  'starts-early': 'player.reportStartsEarly',
  'starts-late': 'player.reportStartsLate',
  'ends-early': 'player.reportEndsEarly',
  'ends-late': 'player.reportEndsLate',
  'not-there': 'player.reportNotThere',
  missing: 'player.reportMissing',
} as const;

/** What can be wrong with a part: its times when it was found, otherwise only that it is not recognised. */
export function reportProblems(found: boolean): ReportProblem[] {
  return found ? ['starts-early', 'starts-late', 'ends-early', 'ends-late', 'not-there'] : ['missing'];
}

/**
 * A viewer tells the administrator that a recap, intro or credits is wrong in this episode, at the
 * position they are watching. The administrator corrects it in Admin → Intros & credits.
 */
export function SegmentReport({ episodeId, position, found, open, onClose }: { episodeId: number; position: number; found: Record<ReportKind, boolean>; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<ReportKind>('intro');
  const [problem, setProblem] = useState<ReportProblem | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const problems = reportProblems(found[kind]);
  const close = () => {
    setProblem(null);
    setState('idle');
    setError(null);
    onClose();
  };
  const send = async () => {
    if (!problem) return;
    setState('sending');
    setError(null);
    try {
      await api.post(`/api/episodes/${episodeId}/segment-report`, { kind, problem, position: Math.max(0, Math.round(position)) });
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError && err.status === 429 ? t('player.reportTooMany') : errorMessage(err));
    }
  };
  return (
    <Modal title={t('player.reportTitle')} open={open} onClose={close}>
      {state === 'sent' ? (
        <div>
          <p role="status">{t('player.reportThanks')}</p>
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={close} className="h-10 rounded-lg bg-button px-4 font-semibold text-button-ink">{t('common.done')}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">{t('player.reportIntro', { time: formatClock(position) })}</p>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('player.reportWhich')}</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${kind === k ? 'border-accent text-accent' : 'border-line'}`}>
                  <input
                    type="radio"
                    name="report-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setProblem(null);
                    }}
                    className="accent-accent"
                  />
                  {t(KIND_LABEL[k])}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('player.reportProblem')}</legend>
            <div className="space-y-1.5">
              {problems.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="report-problem" value={p} checked={problem === p} onChange={() => setProblem(p)} className="accent-accent" />
                  {t(PROBLEM_LABEL[p], { part: t(KIND_LABEL[kind]).toLowerCase() })}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="h-10 rounded-lg px-4 text-muted hover:bg-raised hover:text-ink">{t('common.cancel')}</button>
            <button type="button" onClick={send} disabled={!problem || state === 'sending'} className="h-10 rounded-lg bg-button px-4 font-semibold text-button-ink disabled:opacity-50">
              {t('player.reportSend')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Which parts were found for the file being played (a result for another file of the episode does not count). */
export function reportFound(segments: EpisodeSegments | null | undefined, fileId: number | null | undefined): Record<ReportKind, boolean> {
  const mine = !!segments && (segments.fileId === null || fileId == null || segments.fileId === fileId);
  return { recap: mine && !!segments?.recap, intro: mine && !!segments?.intro, credits: mine && !!segments?.credits };
}
