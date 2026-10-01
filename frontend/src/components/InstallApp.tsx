import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { isStandalone, useInstall } from '../lib/install';
import { useT } from '../i18n';
import { Modal } from './Modal';
import { toast } from './Toast';

/**
 * "Install app" in the menu: shown only where Vidalune can be installed and is not yet. Browsers that
 * offer installing show their own confirmation; on an iPhone or iPad it explains the Safari steps.
 */
export function InstallApp({ onDone }: { onDone?: () => void }) {
  const { how, install } = useInstall();
  const { t } = useT();
  const [help, setHelp] = useState(false);
  if (!how) return null;
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (how === 'ios') {
            setHelp(true);
            return;
          }
          if (await install()) {
            toast.success(t('install.installed'));
            onDone?.();
          }
        }}
        className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[0.95rem] text-muted transition-colors hover:bg-raised/60 hover:text-ink"
      >
        <Download className="size-[1.15rem]" strokeWidth={1.9} />
        {t('nav.installApp')}
      </button>
      <Modal title={t('install.title')} open={help} onClose={() => setHelp(false)}>
        <p className="text-muted">{t('install.iosIntro')}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5">
          <li>{t('install.iosStep1')}</li>
          <li>{t('install.iosStep2')}</li>
          <li>{t('install.iosStep3')}</li>
        </ol>
        <p className="mt-4 text-sm text-faint">{t('install.iosOtherBrowser')}</p>
      </Modal>
    </>
  );
}

/** Pages reachable from the menu; everything else gets a Back button when there is no browser bar. */
const TOP_LEVEL = ['/', '/movies', '/shows', '/collections', '/watchlist', '/favorites', '/search'];
/** Sections from the menu whose pages are tabs of that section. */
const TOP_LEVEL_SECTIONS = ['/account', '/admin'];
const isTopLevel = (path: string) => TOP_LEVEL.includes(path) || TOP_LEVEL_SECTIONS.some((s) => path === s || path.startsWith(`${s}/`));

/**
 * A Back button for the installed app, which has no browser bar with one (an iPhone has no back
 * gesture either). Shown on pages below the menu, when there is somewhere in Vidalune to go back to.
 */
export function AppBackButton({ className = '' }: { className?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  if (!isStandalone() || location.key === 'default' || isTopLevel(location.pathname)) return null;
  return (
    <button type="button" onClick={() => navigate(-1)} className={`grid size-10 place-items-center rounded-full text-muted hover:text-ink ${className}`} aria-label={t('nav.back')} title={t('nav.back')}>
      <ArrowLeft className="size-5" />
    </button>
  );
}
