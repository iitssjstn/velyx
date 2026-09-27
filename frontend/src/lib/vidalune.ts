/**
 * app.vidalune.com: the Vidalune account site that shows this web interface for the server its
 * visitor chose. Its own pages (sign in, choose a server) live under /_vl there.
 */
const SIGNED_OUT = 'vidalune.signedOut';
const AUTO_OPEN = 'vidalune.autoOpen';

/** The account site's page listing your servers (to choose another one). */
export const serversPage = (appUrl: string) => `${appUrl}/_vl/servers?choose`;

/** Whether this page is shown on app.vidalune.com (not at the server's own address). */
export function onVidaluneApp(appUrl: string | null | undefined, origin = window.location.origin): boolean {
  return !!appUrl && appUrl === origin;
}

const session = {
  get: (key: string) => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      /* private window */
    }
  },
};

/** Signed out on purpose: do not sign straight back in with the Vidalune account (this tab). */
export const markSignedOut = () => session.set(SIGNED_OUT, '1');

/**
 * On app.vidalune.com without a session here: sign in with the Vidalune account again, unless the
 * visitor signed out or it was tried less than half a minute ago (no loops).
 */
export function shouldAutoOpen(now = Date.now()): boolean {
  if (session.get(SIGNED_OUT)) return false;
  const last = Number(session.get(AUTO_OPEN) ?? 0);
  if (now - last < 30_000) return false;
  session.set(AUTO_OPEN, String(now));
  return true;
}

/** Signing in with the Vidalune account on app.vidalune.com (the server chosen there). */
export function openWithVidalune(): void {
  session.set(SIGNED_OUT, null);
  window.location.assign('/_vl/open');
}
