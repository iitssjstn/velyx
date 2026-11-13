// Opening a server from the account pages: where a browser may go, and waiting for the relay.

const plain = (url) => String(url ?? '').replace(/\/+$/, '');

/**
 * The addresses a browser can open the web interface at, in the order given. The server's direct
 * address and its home-network addresses only serve media to a player that holds a token: opening
 * the web interface there is always refused (401), so they are never a page to go to. The relay
 * address only when the relay is connected (otherwise it can only say so).
 */
export function pageAddresses(addresses, server) {
  const mediaOnly = new Set([server?.directAccess?.url, ...(server?.endpoints ?? []).map((e) => e?.url)].filter(Boolean).map(plain));
  if (server?.relayUrl && !server.relayConnected) mediaOnly.add(plain(server.relayUrl));
  return (addresses ?? []).filter((a) => a && !mediaOnly.has(plain(a)));
}

/** How long to wait for a relay that is reconnecting (the server restarted, the network hiccuped). */
export const RELAY_TRIES = 5;
export const RELAY_WAIT_MS = 2000;

/**
 * The server as it is now, asked again a few times while its relay is reconnecting. Resolves with
 * the server once its relay is connected, or with the last answer when it does not come back.
 */
export async function waitForRelay(server, load, { tries = RELAY_TRIES, waitMs = RELAY_WAIT_MS, sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms)) } = {}) {
  let current = server;
  for (let i = 0; i < tries && current?.relayUrl && !current.relayConnected; i++) {
    await sleep(waitMs);
    const fresh = await load().catch(() => null);
    if (fresh) current = fresh;
  }
  return current;
}
