import { describe, expect, it } from 'vitest';
import { autoOpenServer, CLOUD_ACCOUNT_KEY, CloudError, connectPending, createCloud, PENDING_CONNECT_KEY, serverAddresses, signInWithTicket, sortServers, TicketError, type CloudServer, type KeyStore } from './cloud';

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe('Vidalune account service', () => {
  it('signs in as the app and sends the token afterwards', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith('/api/login') ? { email: 'a@b.nl', token: 't'.repeat(43) } : []), { status: 200 });
    }) as unknown as typeof fetch;
    const cloud = createCloud(fetchImpl, 'https://vidalune.example');
    const account = await cloud.signIn(' a@b.nl ', 'secret-password');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'a@b.nl', password: 'secret-password', client: 'app' });
    await cloud.servers(account.token);
    expect(calls[1]!.url).toBe('https://vidalune.example/api/servers');
    expect(calls[1]!.init.headers).toMatchObject({ Authorization: `Bearer ${'t'.repeat(43)}` });
  });

  it('turns answers into problems the app can explain', async () => {
    const problem = (fetchImpl: unknown, fn: 'signIn' | 'servers' = 'signIn') =>
      (fn === 'signIn' ? createCloud(fetchImpl as typeof fetch).signIn('a@b.nl', 'x') : createCloud(fetchImpl as typeof fetch).servers('token')).then(
        () => 'ok',
        (e: CloudError) => e.problem,
      );
    expect(await problem(answer(401, {}))).toBe('wrong');
    expect(await problem(answer(429, {}))).toBe('tooMany');
    expect(await problem(answer(401, {}), 'servers')).toBe('signedOut');
    expect(await problem(async () => { throw new Error('offline'); })).toBe('unreachable');
  });

  it('signs in on a server with a ticket, or leaves it to a password', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ token: 't'.repeat(43), user: { id: 7, username: 'lisa' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await signInWithTicket('https://k7f3q9ma.vidalune.com', 'ticket-ticket-ticket-ticket', 'Pixel 8', 'VidaluneApp/0.10.5 (Android 15; Pixel 8)', ok);
    expect(r?.user).toMatchObject({ username: 'lisa' });
    expect(calls[0]!.url).toBe('https://k7f3q9ma.vidalune.com/api/auth/app/ticket');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ticket: 'ticket-ticket-ticket-ticket', deviceName: 'Pixel 8' });
    // Refused: the server's own reason (never a second sign-in).
    const refused = (async () => new Response(JSON.stringify({ error: 'Ask its administrator to invite you again.' }), { status: 403 })) as unknown as typeof fetch;
    await expect(signInWithTicket('https://x', 'ticket-ticket-ticket-ticket', 'Pixel 8', 'ua', refused)).rejects.toThrow(new TicketError('Ask its administrator to invite you again.'));
    const empty = (async () => new Response('oops', { status: 502 })) as unknown as typeof fetch;
    await expect(signInWithTicket('https://x', 'ticket-ticket-ticket-ticket', 'Pixel 8', 'ua', empty)).rejects.toBeInstanceOf(TicketError);
  });

  it('tries the server\'s own address before the relay', () => {
    const s: CloudServer = { id: '1', name: 'Thuis', version: '1', url: 'https://media.example.com', relayUrl: 'https://k7f3q9ma.vidalune.com', online: true, lastSeenAt: 0 };
    expect(serverAddresses(s)).toEqual(['https://media.example.com', 'https://k7f3q9ma.vidalune.com']);
    expect(serverAddresses({ ...s, url: null })).toEqual(['https://k7f3q9ma.vidalune.com']);
  });

  it('lists servers that can be opened first', () => {
    const s = (name: string, url: string | null, online: boolean): CloudServer => ({ id: name, name, version: '1', url, online, lastSeenAt: 0 });
    expect(sortServers([s('Zolder', null, true), s('Oud', 'https://b', false), s('Thuis', 'https://a', true)]).map((x) => x.name)).toEqual(['Thuis', 'Oud', 'Zolder']);
  });
});

describe('connecting the Vidalune account after a sign-in by password', () => {
  const store = (initial: Record<string, string>): KeyStore & { data: Record<string, string> } => {
    const data = { ...initial };
    return {
      data,
      getItemAsync: async (k) => data[k] ?? null,
      setItemAsync: async (k, v) => void (data[k] = v),
      deleteItemAsync: async (k) => void delete data[k],
    };
  };
  const cloudAnswering = (ticket: string) => createCloud((async () => new Response(JSON.stringify({ ticket, addresses: [] }), { status: 200 })) as unknown as typeof fetch, 'https://vidalune.example');

  it('connects once, with a fresh ticket, and forgets the server afterwards', async () => {
    const keys = store({ [PENDING_CONNECT_KEY]: 'srv-1', [CLOUD_ACCOUNT_KEY]: JSON.stringify({ email: 'a@b.nl', token: 't'.repeat(43) }) });
    const posts: Array<[string, unknown]> = [];
    expect(await connectPending(keys, async (path, body) => void posts.push([path, body]), cloudAnswering('x'.repeat(43)))).toBe(true);
    expect(posts).toEqual([['/api/account/cloud/claim', { ticket: 'x'.repeat(43) }]]);
    expect(keys.data[PENDING_CONNECT_KEY]).toBeUndefined();
    // Nothing pending: nothing sent.
    expect(await connectPending(keys, async (path, body) => void posts.push([path, body]), cloudAnswering('y'.repeat(43)))).toBe(false);
    expect(posts).toHaveLength(1);
  });

  it('never gets in the way when it does not work', async () => {
    const keys = store({ [PENDING_CONNECT_KEY]: 'srv-1', [CLOUD_ACCOUNT_KEY]: JSON.stringify({ email: 'a@b.nl', token: 't'.repeat(43) }) });
    const failing = async () => {
      throw new Error('server said no');
    };
    expect(await connectPending(keys, failing, cloudAnswering('x'.repeat(43)))).toBe(false);
    expect(keys.data[PENDING_CONNECT_KEY]).toBeUndefined();
  });

  it('opens the server by itself after signing in: the one opened last, or the only one', () => {
    const s = (id: string, url: string | null, online = true, relayUrl: string | null = null): CloudServer => ({ id, name: id, version: '1', url, relayUrl, online, lastSeenAt: 0 });
    // The only server, online with an address (as for most people): straight in.
    expect(autoOpenServer([s('home', 'https://vidalune.example.nl')], null)?.id).toBe('home');
    expect(autoOpenServer([s('home', null, true, 'https://abc.relay.vidalune.com')], null)?.id).toBe('home');
    // Not when it cannot be opened: no address, or offline (the list says why).
    expect(autoOpenServer([s('home', null)], null)).toBeNull();
    expect(autoOpenServer([s('home', 'https://a', false)], null)).toBeNull();
    expect(autoOpenServer([], null)).toBeNull();
    // Several: the one opened last; otherwise the person chooses.
    const two = [s('home', 'https://a'), s('friend', 'https://b')];
    expect(autoOpenServer(two, 'friend')?.id).toBe('friend');
    expect(autoOpenServer(two, null)).toBeNull();
    expect(autoOpenServer(two, 'gone')).toBeNull();
    expect(autoOpenServer([s('home', 'https://a'), s('old', null)], null)).toBeNull();
  });
});
