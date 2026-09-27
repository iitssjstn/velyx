import { useId } from 'react';
import { t } from '../i18n';

/** Logo: a crescent moon with a play button in its hollow, and the lowercase wordmark. */
export function Logo({ size = 'md', withTagline = false }: { size?: 'sm' | 'md' | 'lg'; withTagline?: boolean }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-5xl' }[size];
  const mark = { sm: 22, md: 26, lg: 52 }[size];
  const cut = useId();
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2" aria-label="Vidalune">
        <svg width={mark} height={mark} viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="var(--color-raised)" />
          <mask id={cut}>
            <rect width="64" height="64" fill="white" />
            <circle cx="43" cy="32" r="17" fill="black" />
          </mask>
          <circle cx="35" cy="32" r="20" fill="var(--color-accent)" mask={`url(#${cut})`} />
          <path d="M37 24l12 8-12 8z" fill="var(--color-accent)" />
        </svg>
        <span className={`font-display font-semibold tracking-tight lowercase ${text}`}>vidalune</span>
      </div>
      {withTagline && <p className="mt-2 text-muted">{t('auth.tagline')}</p>}
    </div>
  );
}
