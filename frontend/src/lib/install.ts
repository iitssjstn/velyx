import { useSyncExternalStore } from 'react';

/** Chrome's install prompt (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/**
 * Listens for the browser offering to install Velyx. Called once at start-up, before React renders,
 * because the browser may make the offer right away.
 */
export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Our own "Install app" button makes the offer instead of the browser's banner.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Registers the service worker (production builds only; it only provides the offline page). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

/** Velyx runs as an installed app (its own window, no browser bar). */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad, where apps are added from Safari's Share menu rather than offered by the browser. */
export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

type InstallState = 'prompt' | 'ios' | null;

function snapshot(): InstallState {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * How Velyx can be installed on this device: 'prompt' (the browser offers it), 'ios' (by hand from
 * Safari's Share menu) or null (installed already, or not possible in this browser).
 */
export function useInstall(): { how: InstallState; install: () => Promise<boolean> } {
  const how = useSyncExternalStore(subscribe, snapshot, () => null);
  const install = async () => {
    const offer = deferred;
    if (!offer) return false;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    // An offer can be used once; the browser makes a new one if the user declined.
    deferred = null;
    notify();
    return outcome === 'accepted';
  };
  return { how, install };
}
