import type { ReactNode } from 'react';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { ApiError, errorMessage } from '../lib/api';
import { useOptionalAuth } from '../lib/auth';
import { Logo } from './Logo';
import { useT } from '../i18n';
import { Button } from './Button';

export function Spinner({ className = '' }: { className?: string }) {
  const { t } = useT();
  return <LoaderCircle className={`animate-spin text-accent ${className}`} aria-label={t('common.loading')} />;
}

export function FullscreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-6">
        <Logo size="lg" />
        <Spinner className="size-6" />
      </div>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      {icon && <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-raised text-accent">{icon}</div>}
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      {children && <div className="mt-2 text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * Friendly error display. Administrators additionally see the server-side diagnostic message/stack
 * that the API only includes for admin sessions.
 */
export function ErrorState({ title, error, onRetry, fullscreen }: { title?: string; error?: unknown; onRetry?: () => void; fullscreen?: boolean }) {
  const { t } = useT();
  const isAdmin = useOptionalAuth()?.user?.role === 'admin';
  const detail = error instanceof ApiError ? error.detail : undefined;
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className={`grid place-items-center px-6 ${fullscreen ? 'min-h-dvh' : 'min-h-[50vh]'}`}>
      <div className="max-w-lg text-center">
        {fullscreen && (
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
        )}
        <h1 className="font-display text-3xl font-semibold">{notFound ? t('errors.notFound') : (title ?? t('errors.generic'))}</h1>
        <p className="mt-3 text-muted">{error ? errorMessage(error) : t('errors.tryAgainText')}</p>
        {onRetry && (
          <Button className="mt-6" variant="secondary" onClick={onRetry} icon={<RotateCcw className="size-4" />}>
            {t('common.tryAgain')}
          </Button>
        )}
        {isAdmin && detail && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-sm text-muted">{t('errors.diagnostics')}</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface p-3 text-xs text-muted">{detail.stack ?? detail.message}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
