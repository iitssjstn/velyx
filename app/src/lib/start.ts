/**
 * Where the app starts: the Vidalune account, or Home. A server opened with the Vidalune account is
 * signed in to again with that account (never a second sign-in); only a server entered by address
 * has a sign-in of its own.
 */
export function startRoute(s: { serverUrl: string | null; signedIn: boolean; viaAccount?: boolean }): '/cloud' | '/sign-in' | '/home' {
  if (!s.serverUrl) return '/cloud';
  if (!s.signedIn) return s.viaAccount ? '/cloud' : '/sign-in';
  return '/home';
}
