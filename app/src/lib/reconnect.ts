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

/** The first address that answers as a Vidalune server, or null. */
export async function findReachable(candidates: readonly string[], fetchImpl: typeof fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
  for (const base of candidates) {
    try {
      const res = await fetchImpl(`${base}/api/server/info`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        const info = (await res.json()) as { name?: unknown } | null;
        if (info && typeof info === 'object' && 'name' in info) return base;
      }
    } catch {
      /* this one does not answer: the next */
    }
  }
  return null;
}
