import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export function NotFoundPage() {
  const { t } = useT();
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl font-semibold text-accent/70">404</p>
        <h1 className="mt-3 font-display text-2xl font-semibold">{t('notFound.title')}</h1>
        <p className="mt-2 text-muted">{t('notFound.text')}</p>
        <Link to="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-accent px-4 font-semibold text-accent-ink">
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
}
