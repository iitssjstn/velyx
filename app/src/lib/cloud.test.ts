import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoOpenServer, CloudError, createCloud, serverAddresses, signInWithTicket, sortServers, TicketError, type CloudServer } from './cloud';

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

afterEach(() => vi.useRealTimers());

describe('Vidalune account service', () => {
  it('changes the password of the Vidalune account, not of the server', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await createCloud(fetchImpl, 'https://vidalune.example').changePassword('t'.repeat(43), 'old-password', 'new-password', 'nl');
    expect(calls[0]!.url).toBe('https://vidalune.example/api/account/password');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${'t'.repeat(43)}` });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ current: 'old-password', password: 'new-password', lang: 'nl' });
  });

  it('says the current password is wrong, and only says signed out when the session really ended', async () => {
    const cloud = (body: unknown) => createCloud(answer(401, body) as unknown as typeof fetch, 'https://vidalune.example');
    await expect(cloud({ error: 'Wrong password.' }).changePassword('t'.repeat(43), 'typo', 'new-password')).rejects.toMatchObject({ problem: 'wrongPassword' });
    await expect(cloud({ error: 'Sign in first.' }).changePassword('t'.repeat(43), 'old-password', 'new-password')).rejects.toMatchObject({ problem: 'signedOut' });
    await expect(cloud({ error: 'Sign in first.' }).servers('t'.repeat(43))).rejects.toMatchObject({ problem: 'signedOut' });
  });

  it('signs a TV in with a code: asks for one, then asks with its secret until it was entered', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const answers = [
      { code: 'K7F3-Q9MA', check: '4271', device: 'd'.repeat(43), url: 'https://vidalune.example/tv', expiresIn: 600, interval: 5 },
      { pending: true },
      { email: 'a@b.nl', token: 't'.repeat(43) },
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answers.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const cloud = createCloud(fetchImpl, 'https://vidalune.example');
    const code = await cloud.tvCode();
    expect(await cloud.tvPoll(code.device)).toEqual({ pending: true });
    expect(await cloud.tvPoll(code.device)).toEqual({ email: 'a@b.nl', token: 't'.repeat(43) });
    expect(calls.map((c) => c.url)).toEqual(['https://vidalune.example/api/tv/code', 'https://vidalune.example/api/tv/poll', 'https://vidalune.example/api/tv/poll']);
    expect(calls[1]!.body).toEqual({ device: 'd'.repeat(43) });
  });

  it('says when a TV code has expired', async () => {
    await expect(createCloud(answer(410, { error: 'expired' }) as unknown as typeof fetch, 'https://vidalune.example').tvPoll('d'.repeat(43))).rejects.toMatchObject({ problem: 'expired' });
  });

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

  it('signs up in the app\'s language, and says when the password is chosen through an email instead', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ email: 'a@b.nl', pending: 'email' }), { status: 202 });
    }) as unknown as typeof fetch;
    const result = await createCloud(fetchImpl, 'https://vidalune.example').signUp('a@b.nl', 'secret-password', 'nl');
    expect(bodies[0]).toEqual({ email: 'a@b.nl', password: 'secret-password', client: 'app', lang: 'nl' });
    expect(result).toEqual({ email: 'a@b.nl', pending: 'email' });
    expect('pending' in result).toBe(true);
  });

  it('keeps the cloud timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    }));
    const request = createCloud(fetchImpl, 'https://vidalune.example', 100).servers('token');
    const rejection = expect(request).rejects.toThrow(new CloudError('unreachable'));
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a ticket sign-in that never answers', async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const request = signInWithTicket('https://server.example', 'ticket', 'phone', 'ua', fetchImpl, 100);
    const rejection = expect(request).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
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
    const s: CloudServer = { id: '1', name: 'Thuis', version: '1', url: 'https://legacy.example.com', directAccess: { configured: true, url: 'https://server.media.vidalune.com:32400', port: 32400, dnsReady: true, tlsReady: true, portOpen: true }, endpoints: [{ type: 'lan', address: '192.168.1.50', port: 32400, protocol: 'https', url: 'https://192.168.1.50:32400' }, { type: 'public', address: '8.8.8.8', port: 32400, protocol: 'https', url: 'https://server.media.vidalune.com:32400', reachable: true }], relayUrl: 'https://k7f3q9ma.vidalune.com', online: true, lastSeenAt: 0 };
    expect(serverAddresses(s)).toEqual(['https://192.168.1.50:32400', 'https://server.media.vidalune.com:32400', 'https://legacy.example.com', 'https://k7f3q9ma.vidalune.com']);
    expect(serverAddresses({ ...s, url: null })).toEqual(['https://192.168.1.50:32400', 'https://server.media.vidalune.com:32400', 'https://k7f3q9ma.vidalune.com']);
  });

  it('lists servers that can be opened first', () => {
    const s = (name: string, url: string | null, online: boolean): CloudServer => ({ id: name, name, version: '1', url, online, lastSeenAt: 0 });
    expect(sortServers([s('Zolder', null, true), s('Oud', 'https://b', false), s('Thuis', 'https://a', true)]).map((x) => x.name)).toEqual(['Thuis', 'Oud', 'Zolder']);
  });
});

describe('opening a server', () => {
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
