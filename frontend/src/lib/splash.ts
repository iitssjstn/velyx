/**
 * The opening screen (the logo in index.html, drawn before the app has loaded). It fades out once the
 * first screen and its data are ready, but the first time in a tab it stays at least SPLASH_MIN_MS
 * after the page started (so the logo is seen, not a flash), and never longer than SPLASH_MAX_MS.
 */
export const SPLASH_MIN_MS = 900;
export const SPLASH_MAX_MS = 4000;
const FADE_MS = 450;

/** How long to wait before fading out, `elapsed` ms after the page started. */
export function splashDelay(elapsed: number, min = SPLASH_MIN_MS): number {
  return Math.max(0, Math.round(min - elapsed));
}

let hidden = false;

const OPENED_KEY = 'vidalune.opened';

/**
 * Whether Vidalune was opened before in this tab (a refresh, or coming back from another site): the
 * logo has been seen, so the opening screen goes as soon as the page is ready. Marks it as opened.
 */
function openedBefore(): boolean {
  try {
    const before = sessionStorage.getItem(OPENED_KEY) === '1';
    sessionStorage.setItem(OPENED_KEY, '1');
    return before;
  } catch {
    // No storage (private mode in some browsers): as a first visit.
    return false;
  }
}

/** Fades the opening screen out (once; later calls do nothing). */
export function hideSplash(now: () => number = () => performance.now()): void {
  if (hidden) return;
  hidden = true;
  const again = openedBefore();
  const el = document.getElementById('splash');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('done');
    setTimeout(() => el.remove(), FADE_MS + 50);
  }, splashDelay(now(), again ? 0 : SPLASH_MIN_MS));
}

/** For tests: as if the page was just opened. */
export function resetSplash(): void {
  hidden = false;
  try {
    sessionStorage.removeItem(OPENED_KEY);
  } catch {
    /* no storage */
  }
}

/** For tests: as if the page was loaded again in the same tab. */
export function reloadSplash(): void {
  hidden = false;
}
