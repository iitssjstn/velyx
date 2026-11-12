/**
 * Finding the server again after the connection was lost (the app was in the background, the phone
 * left the home Wi-Fi): the address in use first, then the server's other addresses (its own and
 * the relay). Pure logic; the session runs it.
 */

/** How often an unreachable server is tried again while the app is open. */
export const RECONNECT_EVERY_MS = 5000;
/** How long one try may take. */
export const PROBE_TIMEOUT_MS = 6000;

/** The addresses to try, the current one first, each once. */
export function reconnectOrder(current: string, others: readonly string[] = []): string[] {
  return [...new Set([current, ...others].filter(Boolean))];
}

/** How long one try at a faster address may take (an address on the home network answers at once). */
export const FASTER_TIMEOUT_MS = 2500;
/** Once an address answered: how long the ones before it in the list still get. */
export const PREFER_GRACE_MS = 1500;

/**
 * The addresses that are faster than the one in use: those before it in the server's list (home
 * network first, then its own address, the relay last). None when the address in use is not in
 * the list, or is already the first.
 */
export function fasterAddresses(current: string, addresses: readonly string[] = []): string[] {
  // The address in use is stored without a closing slash; the list may have one.
  const plain = (url: string) => url.replace(/\/+$/, '');
  const list = addresses.filter(Boolean).map(plain);
  const at = list.indexOf(plain(current));
  return at > 0 ? [...new Set(list.slice(0, at))] : [];
}

async function answers(base: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base}/api/server/info`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const info = (await res.json()) as { name?: unknown } | null;
    return Boolean(info && typeof info === 'object' && 'name' in info);
  } catch {
    return false;
  }
}

/**
 * The address that answers as a Vidalune server, or null. All are asked at the same time; the
 * earliest in the list wins. One that hangs does not hold up the rest: once a later address
 * answered, the ones before it get `graceMs` more.
 */
export function findReachable(candidates: readonly string[], fetchImpl: typeof fetch, timeoutMs = PROBE_TIMEOUT_MS, graceMs = PREFER_GRACE_MS): Promise<string | null> {
  if (!candidates.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    // undefined: still asking.
    const state: (boolean | undefined)[] = candidates.map(() => undefined);
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (found: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(grace);
      resolve(found);
    };
    const settle = () => {
      const first = state.findIndex((s) => s !== false);
      if (first === -1) return finish(null);
      if (state[first]) return finish(candidates[first]);
      // An earlier address is still asking while a later one answered: it gets a little longer.
      const best = state.indexOf(true);
      if (best !== -1 && grace === undefined) grace = setTimeout(() => finish(candidates[state.indexOf(true)]), graceMs);
    };
    candidates.forEach((base, i) => {
      void answers(base, fetchImpl, timeoutMs).then((ok) => {
        state[i] = ok;
        settle();
      });
    });
  });
}
