import { describe, expect, it } from 'vitest';
import { startRoute } from './start';

describe('where the app starts', () => {
  it('asks for the Vidalune account first, then the server sign-in, then Home', () => {
    expect(startRoute({ serverUrl: null, signedIn: false })).toBe('/cloud');
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: false })).toBe('/sign-in');
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: true })).toBe('/home');
  });

  it('signs in again with the Vidalune account when the server was opened with it — no second sign-in', () => {
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: false, viaAccount: true })).toBe('/cloud');
    expect(startRoute({ serverUrl: 'https://media.example.com', signedIn: true, viaAccount: true })).toBe('/home');
  });
});
