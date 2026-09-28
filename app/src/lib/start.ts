/** Where the app starts: the Vidalune account (an address is the other way in), sign in, or Home. */
export function startRoute(s: { serverUrl: string | null; signedIn: boolean }): '/cloud' | '/sign-in' | '/home' {
  if (!s.serverUrl) return '/cloud';
  if (!s.signedIn) return '/sign-in';
  return '/home';
}
