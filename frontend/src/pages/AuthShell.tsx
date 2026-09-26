import type { ReactNode } from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, setLanguage, useT, type Language } from '../i18n';
import { Logo } from '../components/Logo';

/** Split layout used by the setup wizard and the sign-in page. */
export function AuthShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const { t, lang } = useT();
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Before signing in: pick the language here; afterwards it is a setting of the account. */}
      <label className="absolute top-4 right-4 z-10 flex items-center gap-2 text-xs text-muted">
        <Languages className="size-4" aria-hidden />
        <span className="sr-only">{t('settings.language.title')}</span>
        <select className="input h-8 w-auto py-0 text-xs" value={lang} onChange={(e) => void setLanguage(e.target.value as Language)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_10%,color-mix(in_oklab,var(--color-accent)_28%,transparent),transparent_60%),radial-gradient(90%_70%_at_90%_100%,color-mix(in_oklab,var(--color-amber)_16%,transparent),transparent_60%)]" />
        <div className="absolute inset-0 grid grid-cols-5 gap-4 p-10 opacity-[0.16] [transform:rotate(-8deg)_scale(1.25)]" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl bg-ink" style={{ opacity: 0.25 + ((i * 37) % 60) / 100 }} />
          ))}
        </div>
        <div className="relative flex h-full flex-col justify-end p-14">
          <Logo size="lg" />
          <p className="mt-4 max-w-sm font-display text-3xl leading-tight text-ink/90">{t('auth.tagline')}</p>
          {aside}
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo withTagline />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
