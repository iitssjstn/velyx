import { describe, expect, it } from 'vitest';
import { CloudError, createCloud, sortServers, type CloudServer } from './cloud';

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

  it('lists servers that can be opened first', () => {
    const s = (name: string, url: string | null, online: boolean): CloudServer => ({ id: name, name, version: '1', url, online, lastSeenAt: 0 });
    expect(sortServers([s('Zolder', null, true), s('Oud', 'https://b', false), s('Thuis', 'https://a', true)]).map((x) => x.name)).toEqual(['Thuis', 'Oud', 'Zolder']);
  });
});
