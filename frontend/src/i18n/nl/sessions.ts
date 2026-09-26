import type { Messages } from '../index';
export const sessions: Messages['sessions'] = {
  ended: 'Sessie beëindigd.',
  endedCount: {
    one: '{count} sessie beëindigd.',
    other: '{count} sessies beëindigd.',
  },
  loadFailed: 'Kon de sessies niet laden.',
  none: 'Geen actieve sessies.',
  thisDevice: 'Dit apparaat',
  activeSignedIn: 'Actief {active} · ingelogd {signedIn}',
  revoke: 'Intrekken',
  revokeAll: 'Alle sessies intrekken',
  signOutOthers: 'Alle andere apparaten uitloggen',
};
