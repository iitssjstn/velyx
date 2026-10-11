import { describe, expect, it } from 'vitest';
import { createStoredSession } from './storedSession';

type S = { serverUrl: string; token: string | null; cloudServerId: string | null };

describe('stored session', () => {
  it('signs in to the server chosen just before, not the one from an earlier render', async () => {
    const written: Array<S | null> = [];
    const store = createStoredSession<S>(async (next) => {
      written.push(next);
    });
    store.load({ serverUrl: 'https://old.example', token: 'old', cloudServerId: 'old-id' });
    // What the account flow does: choose the new server, then sign in, without a render in between.
    const chosen = store.save({ serverUrl: 'https://new.example', token: null, cloudServerId: 'new-id' });
    const signedIn = store.change((s) => ({ ...s, token: 'new' }));
    await Promise.all([chosen, signedIn]);
    expect(written.at(-1)).toEqual({ serverUrl: 'https://new.example', token: 'new', cloudServerId: 'new-id' });
    expect(store.current()).toEqual(written.at(-1));
  });

  it('changes nothing into a session when there is none', async () => {
    const written: Array<S | null> = [];
    const store = createStoredSession<S>(async (next) => {
      written.push(next);
    });
    await store.change((s) => ({ ...s, token: 'x' }));
    expect(written).toEqual([null]);
  });
});
