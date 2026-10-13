/**
 * Where the app starts: the Vidalune account, or Home. The app only opens servers through the
 * Vidalune account (nobody types an address); signing in again goes through the account too.
 */
export function startRoute(s: { serverUrl: string | null; signedIn: boolean }): '/cloud' | '/home' {
  return s.serverUrl && s.signedIn ? '/home' : '/cloud';
}

/**
 * Whether a stored session is kept at app start. Before 0.19.55 a server could be opened by typing
 * its address; such a session (no Vidalune account behind it) is dropped, so the app asks for the
 * account once and connects by itself from then on. The watch progress stays on the server.
 */
export function keepsSession(s: { cloudServerId?: string | null } | null): boolean {
  return Boolean(s?.cloudServerId);
}

/** The server's current name and version (they change with an update), or null when nothing changed. */
export function withServerInfo<S extends { serverName: string; serverVersion: string }>(s: S, info: { name?: unknown; version?: unknown }): S | null {
  const name = typeof info.name === 'string' && info.name ? info.name : s.serverName;
  const version = typeof info.version === 'string' && info.version ? info.version : s.serverVersion;
  return name === s.serverName && version === s.serverVersion ? null : { ...s, serverName: name, serverVersion: version };
}
