import { describe, expect, it } from 'vitest';
import { keepsSession, startRoute, withServerInfo } from './start';

describe('where the app starts', () => {
  it('asks for the Vidalune account, then goes Home — never for an address or a second sign-in', () => {
    expect(startRoute({ serverUrl: null, signedIn: false })).toBe('/cloud');
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: false })).toBe('/cloud');
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: true })).toBe('/home');
  });

  it('drops a session of a server opened by typing its address (before 0.19.55), keeps one opened with the account', () => {
    expect(keepsSession({ cloudServerId: 'srv-1' })).toBe(true);
    expect(keepsSession({ cloudServerId: null })).toBe(false);
    // Stored by an older app, without the field at all.
    expect(keepsSession({})).toBe(false);
    expect(keepsSession(null)).toBe(false);
  });
});

describe('the server name and version shown in the app', () => {
  const s = { serverUrl: 'https://a', serverName: 'Vidalune', serverVersion: '0.19.6' };

  it('follows the server after an update instead of keeping what it said when the app was connected', () => {
    expect(withServerInfo(s, { name: 'Vidalune', version: '0.19.55' })).toEqual({ ...s, serverVersion: '0.19.55' });
    expect(withServerInfo(s, { name: 'Thuis', version: '0.19.6' })).toEqual({ ...s, serverName: 'Thuis' });
  });

  it('changes nothing when it is the same, or when the answer is not usable', () => {
    expect(withServerInfo(s, { name: 'Vidalune', version: '0.19.6' })).toBeNull();
    expect(withServerInfo(s, {})).toBeNull();
    expect(withServerInfo(s, { name: '', version: 42 })).toBeNull();
  });
});
