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

/** A grey placeholder block that gently pulses while content loads. */
function Bone({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-raised/70 ${className}`} />;
}

/** The shape of a detail page (backdrop, poster, title, buttons) while it loads. */
export function DetailSkeleton() {
  const { t } = useT();
  return (
    <div role="status" aria-label={t('common.loading')} className="px-4 pt-6 sm:px-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Bone className="aspect-[2/3] w-36 shrink-0 rounded-[var(--radius-card)] sm:w-48" />
        <div className="flex-1 space-y-3">
          <Bone className="h-9 w-2/3 max-w-md" />
          <Bone className="h-4 w-1/2 max-w-xs" />
          <div className="flex gap-3 pt-3">
            <Bone className="h-12 w-40 rounded-full" />
            <Bone className="size-12 rounded-full" />
            <Bone className="size-12 rounded-full" />
          </div>
        </div>
      </div>
      <div className="mt-10 max-w-2xl space-y-2">
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-11/12" />
        <Bone className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/** Rows of poster placeholders, for Home and the library grids while they load. */
export function ShelfSkeleton({ rows = 2 }: { rows?: number }) {
  const { t } = useT();
  return (
    <div role="status" aria-label={t('common.loading')} className="space-y-10 px-4 pt-6 sm:px-8">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r}>
          <Bone className="mb-3 h-6 w-48" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 8 }, (_, i) => (
              <Bone key={i} className="aspect-[2/3] w-[136px] shrink-0 rounded-[var(--radius-card)] sm:w-40" />
            ))}
          </div>
        </div>
      ))}
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
