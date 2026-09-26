import { t } from '../i18n';
/** Text logo: lowercase wordmark with a play-notch cut into the "v". Easy to swap for a real logo later. */
export function Logo({ size = 'md', withTagline = false }: { size?: 'sm' | 'md' | 'lg'; withTagline?: boolean }) {
  const text = { sm: 'text-xl', md: 'text-2xl', lg: 'text-5xl' }[size];
  const mark = { sm: 22, md: 26, lg: 52 }[size];
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2" aria-label="Velyx">
        <svg width={mark} height={mark} viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="var(--color-raised)" />
          <path d="M14 16h10l8 22 8-22h10L37 48H27z" fill="var(--color-accent)" />
          <path d="M29 24l9 5-9 5z" fill="var(--color-raised)" />
        </svg>
        <span className={`font-display font-semibold tracking-tight lowercase ${text}`}>velyx</span>
      </div>
      {withTagline && <p className="mt-2 text-muted">{t('auth.tagline')}</p>}
    </div>
  );
}
