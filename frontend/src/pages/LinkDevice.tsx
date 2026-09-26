import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { displayName, useAuth } from '../lib/auth';
import { Button } from '../components/Button';
import { useT } from '../i18n';

type Step = { at: 'enter' } | { at: 'confirm'; code: string; deviceName: string } | { at: 'done'; deviceName: string };

/**
 * Connects the Velyx app to the signed-in account: the app shows a code, it is entered here, and
 * after confirming the app is signed in (it keeps asking the server until then).
 */
export function LinkDevicePage() {
  const { user } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [step, setStep] = useState<Step>({ at: 'enter' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const check = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const found = await api.get<{ code: string; deviceName: string }>(`/api/auth/pair/${encodeURIComponent(code.trim())}`);
      setStep({ at: 'confirm', code: found.code, deviceName: found.deviceName });
    });
  };
  const connect = (s: Extract<Step, { at: 'confirm' }>) =>
    run(async () => {
      await api.post(`/api/auth/pair/${encodeURIComponent(s.code)}/approve`);
      setStep({ at: 'done', deviceName: s.deviceName });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    });
  const restart = () => {
    setCode('');
    setError(null);
    setStep({ at: 'enter' });
  };
  const name = user ? displayName(user) : '';

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <div className="panel p-6 sm:p-8">
        <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Smartphone className="size-6" />
        </div>
        <h1 className="font-display text-2xl font-semibold">{t('link.title')}</h1>

        {step.at === 'enter' && (
          <form onSubmit={check} className="mt-3">
            <p className="text-muted">{t('link.intro')}</p>
            <label className="label mt-6" htmlFor="link-code">{t('link.code')}</label>
            <input
              id="link-code"
              className="input text-center font-mono text-2xl tracking-[0.3em] uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 7))}
              placeholder="ABC-DEF"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
            <Button type="submit" className="mt-5 w-full" loading={busy} disabled={code.replace(/[\s-]/g, '').length < 6}>
              {t('link.check')}
            </Button>
          </form>
        )}

        {step.at === 'confirm' && (
          <div className="mt-3">
            <p className="text-lg">{t('link.confirm', { device: step.deviceName, name })}</p>
            <p className="mt-2 text-sm text-muted">{t('link.confirmHint')}</p>
            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void connect(step)}>{t('link.connect')}</Button>
              <Button variant="ghost" onClick={restart}>{t('link.cancel')}</Button>
            </div>
          </div>
        )}

        {step.at === 'done' && (
          <div className="mt-3" role="status">
            <p className="flex items-start gap-2 text-lg">
              <CheckCircle2 className="mt-1 size-5 shrink-0 text-ok" />
              {t('link.done', { device: step.deviceName, name })}
            </p>
            <p className="mt-2 text-sm text-muted">{t('link.doneHint')}</p>
            <Button variant="ghost" className="mt-6" onClick={restart}>{t('link.another')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
