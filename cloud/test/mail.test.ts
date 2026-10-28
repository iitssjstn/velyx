import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, sessionCookieName } from '../src/app.js';

/** Over https the session cookie carries the __Host- prefix. */
const SESSION_COOKIE = sessionCookieName(true);
import { loadConfig, parseMailHeaders, type MailConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accounts, serviceSettings } from '../src/db/schema.js';
import { Mailer, mailTemplates, type MailTransport } from '../src/mail.js';

const MAIL: MailConfig = { host: 'smtp.example.com', port: 587, secure: false, user: 'token', pass: 'token', from: 'Vidalune <no-reply@vidalune.com>', headers: { 'X-PM-Message-Stream': 'outbound' } };

type Sent = Parameters<MailTransport>[0];
let dir: string;
let db: DB;
let cloud: FastifyInstance;
let sent: Sent[];
let clock: number;

let verified: MailConfig[];
let verifyError: Error | null;
let transportError: Error | null;
async function start(opts: { mail?: MailConfig | null; adminEmails?: string[] } = {}) {
  verified = [];
  verifyError = null;
  transportError = null;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-mail-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.com' }, { webDir: null, mail: opts.mail === undefined ? MAIL : opts.mail, adminEmails: opts.adminEmails ?? [] });
  db = openDatabase(config.dbPath);
  sent = [];
  clock = Date.now();
  cloud = await buildCloudApp(config, db, {
    now: () => clock,
    mailTransport: async (m) => {
      if (transportError) throw transportError;
      sent.push(m);
    },
    mailDelays: [0],
    mailVerify: async (c) => {
      if (verifyError) throw verifyError;
      verified.push(c);
    },
  });
}
afterEach(async () => {
  await cloud.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  return c ? `${SESSION_COOKIE}=${c.value}` : '';
};
const signUp = (email: string, password = 'correct-horse', lang = 'en') => cloud.inject({ method: 'POST', url: '/api/account', headers: { 'accept-language': lang }, payload: { email, password } });
const signIn = (email: string, password: string) => cloud.inject({ method: 'POST', url: '/api/login', payload: { email, password } });
const me = (cookie: string) => cloud.inject({ url: '/api/account', headers: { cookie } });
/** The token in the link of the last message (after "#"). */
const lastLink = () => {
  const m = /https:\/\/vidalune\.com\/(verify|reset|email)#([\w-]+)/.exec(sent.at(-1)!.text);
  return { page: m![1], token: m![2]! };
};
const confirm = (token: string) => cloud.inject({ method: 'POST', url: '/api/email/confirm', payload: { token } });

describe('confirming the email address', () => {
  it('sends a link on sign-up, in the language of the browser, and confirms the address once', async () => {
    await start();
    const res = await signUp('ann@example.com', 'correct-horse', 'nl-NL,nl;q=0.9');
    expect(res.statusCode).toBe(200);
    const cookie = cookieOf(res);
    expect((await me(cookie)).json()).toMatchObject({ emailVerified: false, mail: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ann@example.com', from: MAIL.from, headers: { 'X-PM-Message-Stream': 'outbound' }, subject: 'Bevestig je e-mailadres' });
    const { page, token } = lastLink();
    expect(page).toBe('verify');
    expect((await confirm(token)).json()).toEqual({ purpose: 'verify', email: 'ann@example.com' });
    expect((await me(cookie)).json().emailVerified).toBe(true);
    // Used once.
    expect((await confirm(token)).statusCode).toBe(400);
  });

  it('sends a new link on request, and the old one stops working', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com'));
    const first = lastLink().token;
    expect((await cloud.inject({ method: 'POST', url: '/api/account/verify', headers: { cookie }, payload: {} })).statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await confirm(first)).statusCode).toBe(400);
    expect((await confirm(lastLink().token)).statusCode).toBe(200);
  });

  it('sends at most three messages to one address in ten minutes', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com'));
    const resend = () => cloud.inject({ method: 'POST', url: '/api/account/verify', headers: { cookie }, payload: {} });
    expect((await resend()).statusCode).toBe(200);
    expect((await resend()).statusCode).toBe(200);
    expect((await resend()).statusCode).toBe(200);
    expect((await resend()).statusCode).toBe(429);
    expect((await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'ann@example.com' } })).statusCode).toBe(429);
    expect(sent).toHaveLength(4);
  });

  it('does not work after two days', async () => {
    await start();
    await signUp('ann@example.com');
    clock += 2 * 86_400_000 + 1;
    expect((await confirm(lastLink().token)).json().error).toMatch(/does not work/);
  });

  it('gives the rights of ADMIN_EMAILS only once the address is confirmed', async () => {
    await start({ adminEmails: ['boss@example.com'] });
    const cookie = cookieOf(await signUp('boss@example.com'));
    expect((await me(cookie)).json().admin).toBeUndefined();
    expect((await cloud.inject({ url: '/api/ceo/dashboard', headers: { cookie } })).statusCode).toBe(403);
    await confirm(lastLink().token);
    expect((await me(cookie)).json()).toMatchObject({ admin: true, ceo: true });
  });

  it('shows the CEO which customers have not confirmed their address yet, and lets them filter on it', async () => {
    await start({ adminEmails: ['boss@example.com'] });
    const boss = cookieOf(await signUp('boss@example.com'));
    await confirm(lastLink().token);
    await signUp('new@example.com');
    const list = async (status = 'all') => (await cloud.inject({ url: `/api/ceo/customers?status=${status}`, headers: { cookie: boss } })).json();
    const all = await list();
    expect(all.customers.find((c: { email: string }) => c.email === 'new@example.com').verified).toBe(false);
    expect(all.customers.find((c: { email: string }) => c.email === 'boss@example.com').verified).toBe(true);
    expect(all.summary).toMatchObject({ total: 2, unverified: 1, new7: 2 });
    expect((await list('unverified')).customers.map((c: { email: string }) => c.email)).toEqual(['new@example.com']);
  });

  it('once mail was set up, turning it off again does not hand out the rights of an unconfirmed address', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    // As after mail was set up in the Control Center and later turned off.
    db.insert(serviceSettings).values({ key: 'mail-ever', value: '1', updatedAt: clock, updatedBy: 'ceo@example.com' }).run();
    const cookie = cookieOf(await signUp('boss@example.com'));
    expect((await me(cookie)).json().admin).toBeUndefined();
    expect((await cloud.inject({ url: '/api/ceo/dashboard', headers: { cookie } })).statusCode).toBe(403);
  });

  it('without mail set up, nothing is sent and the rights work as before', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const cookie = cookieOf(await signUp('boss@example.com'));
    expect(sent).toHaveLength(0);
    expect((await me(cookie)).json()).toMatchObject({ admin: true, mail: false, emailVerified: false });
    expect((await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'boss@example.com' } })).statusCode).toBe(503);
  });
});

describe('a TV signed in with a code', () => {
  it('tells the account by email, in its language', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com'));
    const tv = (await cloud.inject({ method: 'POST', url: '/api/tv/code', payload: {} })).json() as { code: string };
    const res = await cloud.inject({ method: 'POST', url: '/api/tv/confirm', headers: { cookie }, payload: { code: tv.code, lang: 'nl' } });
    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.at(-1)).toMatchObject({ to: 'ann@example.com', subject: 'Er is een tv ingelogd met je account' });
    expect(sent.at(-1)!.text).toContain('https://vidalune.com/account');
  });
});

describe('an account made for someone (no password yet)', () => {
  it('is only taken over through a link sent to that address', async () => {
    await start();
    db.insert(accounts).values({ email: 'guest@example.com', passwordHash: '', createdAt: clock, plan: 'viewer' }).run();
    const res = await signUp('guest@example.com', 'attacker-password');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ email: 'guest@example.com', pending: 'email' });
    expect(cookieOf(res)).toBe('');
    // The password from the sign-up was not set.
    expect((await signIn('guest@example.com', 'attacker-password')).statusCode).toBe(401);
    expect(sent[0]).toMatchObject({ to: 'guest@example.com', subject: 'Activate your Vidalune account' });
    const reset = await cloud.inject({ method: 'POST', url: '/api/password/reset', payload: { token: lastLink().token, password: 'guest-password' } });
    expect(reset.statusCode).toBe(200);
    expect((await me(cookieOf(reset))).json()).toMatchObject({ email: 'guest@example.com', emailVerified: true, remote: { kind: 'viewer' } });
    expect((await signIn('guest@example.com', 'guest-password')).statusCode).toBe(200);
  });
});

describe('forgot password', () => {
  it('answers the same for unknown addresses, and sends nothing there', async () => {
    await start();
    const res = await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'nobody@example.com' } });
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it('sets a new password with the link, signs out everywhere else, and the link works once', async () => {
    await start();
    const old = cookieOf(await signUp('ann@example.com', 'old-password'));
    await cloud.inject({ method: 'POST', url: '/api/password/forgot', headers: { 'accept-language': 'nl' }, payload: { email: 'Ann@Example.com' } });
    expect(sent.at(-1)).toMatchObject({ to: 'ann@example.com', subject: 'Nieuw wachtwoord instellen' });
    const { page, token } = lastLink();
    expect(page).toBe('reset');
    const res = await cloud.inject({ method: 'POST', url: '/api/password/reset', payload: { token, password: 'new-password' } });
    expect(res.statusCode).toBe(200);
    expect((await me(old)).statusCode).toBe(401);
    expect((await me(cookieOf(res))).json().emailVerified).toBe(true);
    expect((await signIn('ann@example.com', 'old-password')).statusCode).toBe(401);
    expect((await signIn('ann@example.com', 'new-password')).statusCode).toBe(200);
    expect((await cloud.inject({ method: 'POST', url: '/api/password/reset', payload: { token, password: 'other-password' } })).statusCode).toBe(400);
  });

  it('gives the app a token instead of a cookie', async () => {
    await start();
    await signUp('ann@example.com');
    await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'ann@example.com' } });
    const res = await cloud.inject({ method: 'POST', url: '/api/password/reset', payload: { token: lastLink().token, password: 'new-password', client: 'app' } });
    expect(res.json().token).toMatch(/^[\w-]{40,}$/);
  });

  it('does not work after an hour, or for a suspended account', async () => {
    await start();
    await signUp('ann@example.com');
    await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'ann@example.com' } });
    clock += 60 * 60_000 + 1;
    expect((await cloud.inject({ method: 'POST', url: '/api/password/reset', payload: { token: lastLink().token, password: 'new-password' } })).statusCode).toBe(400);
    db.update(accounts).set({ suspendedAt: clock, suspendedBy: 'ceo' }).run();
    const before = sent.length;
    await cloud.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'ann@example.com' } });
    expect(sent).toHaveLength(before);
  });
});

describe('managing the account', () => {
  it('changes the password with the current one, keeps this browser signed in and tells the address', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com', 'old-password'));
    const other = cookieOf(await signIn('ann@example.com', 'old-password'));
    expect((await cloud.inject({ method: 'POST', url: '/api/account/password', headers: { cookie }, payload: { current: 'wrong', password: 'new-password' } })).statusCode).toBe(401);
    expect((await cloud.inject({ method: 'POST', url: '/api/account/password', headers: { cookie }, payload: { current: 'old-password', password: 'new-password' } })).statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(200);
    expect((await me(other)).statusCode).toBe(401);
    expect(sent.at(-1)).toMatchObject({ to: 'ann@example.com', subject: 'Your password was changed' });
    expect((await signIn('ann@example.com', 'new-password')).statusCode).toBe(200);
  });

  it('moves to another address once the link sent there is opened, and tells the old address', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com'));
    await signUp('taken@example.com');
    const change = (payload: object) => cloud.inject({ method: 'POST', url: '/api/account/email', headers: { cookie }, payload });
    expect((await change({ email: 'new@example.com', password: 'wrong' })).statusCode).toBe(401);
    expect((await change({ email: 'taken@example.com', password: 'correct-horse' })).statusCode).toBe(409);
    expect((await change({ email: 'ann@example.com', password: 'correct-horse' })).statusCode).toBe(400);
    expect((await change({ email: 'new@example.com', password: 'correct-horse' })).json()).toEqual({ pending: 'new@example.com' });
    expect(sent.at(-1)).toMatchObject({ to: 'new@example.com', subject: 'Confirm your new email address' });
    expect(sent.at(-1)!.text).toContain('ann@example.com');
    // Not changed yet.
    expect((await me(cookie)).json().email).toBe('ann@example.com');
    const { page, token } = lastLink();
    expect(page).toBe('email');
    expect((await confirm(token)).json()).toEqual({ purpose: 'email', email: 'new@example.com' });
    expect((await me(cookie)).json()).toMatchObject({ email: 'new@example.com', emailVerified: true });
    expect(sent.at(-1)).toMatchObject({ to: 'ann@example.com', subject: 'Your email address was changed' });
    expect((await signIn('new@example.com', 'correct-horse')).statusCode).toBe(200);
  });

  it('does not move to an address that was taken after the link was sent', async () => {
    await start();
    const cookie = cookieOf(await signUp('ann@example.com'));
    await cloud.inject({ method: 'POST', url: '/api/account/email', headers: { cookie }, payload: { email: 'new@example.com', password: 'correct-horse' } });
    const { token } = lastLink();
    await signUp('new@example.com');
    expect((await confirm(token)).statusCode).toBe(409);
    expect((await me(cookie)).json().email).toBe('ann@example.com');
  });
});

describe('mail settings in the Control Center', () => {
  const POSTMARK = { host: 'smtp.postmarkapp.com', port: 587, secure: false, user: 'server-token-1234', pass: 'server-token-1234', from: 'Vidalune <no-reply@vidalune.com>', headers: 'X-PM-Message-Stream: outbound' };
  async function ceo() {
    const cookie = cookieOf(await signUp('boss@example.com'));
    return (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: object) => cloud.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  }

  it('is only for the CEO', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const cookie = cookieOf(await signUp('ann@example.com'));
    expect((await cloud.inject({ url: '/api/ceo/mail', headers: { cookie } })).statusCode).toBe(403);
    expect((await cloud.inject({ method: 'PUT', url: '/api/ceo/mail', headers: { cookie }, payload: POSTMARK })).statusCode).toBe(403);
  });

  it('checks the settings at the SMTP service, keeps the password to itself, and sends with them from then on', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    expect((await as('GET', '/api/ceo/mail')).json()).toMatchObject({ configured: false, source: null });
    const saved = await as('PUT', '/api/ceo/mail', POSTMARK);
    expect(saved.statusCode).toBe(200);
    expect(verified).toEqual([{ ...POSTMARK, headers: { 'X-PM-Message-Stream': 'outbound' } }]);
    const view = (await as('GET', '/api/ceo/mail')).json();
    expect(view).toMatchObject({ configured: true, source: 'settings', host: 'smtp.postmarkapp.com', headers: 'X-PM-Message-Stream: outbound', hasUser: true, userHint: '••••1234', hasPassword: true, hint: '••••1234' });
    // Neither the password nor the user (at Postmark both are the token) is ever sent back.
    expect(JSON.stringify(view)).not.toContain('server-token-1234');
    expect(JSON.stringify(view)).not.toContain('"pass"');
    // The CEO who turned mail on keeps the Control Center, although the address was not confirmed by email.
    expect((await as('GET', '/api/account')).json()).toMatchObject({ ceo: true, mail: true, emailVerified: true });
    await signUp('ann@example.com');
    expect(sent.at(-1)).toMatchObject({ to: 'ann@example.com', from: 'Vidalune <no-reply@vidalune.com>', headers: { 'X-PM-Message-Stream': 'outbound' } });
  });

  it('saves nothing when the SMTP service refuses, and says why', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    verifyError = new Error('Invalid login: 535 Authentication failed');
    const res = await as('PUT', '/api/ceo/mail', POSTMARK);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('535 Authentication failed');
    expect((await as('GET', '/api/ceo/mail')).json().configured).toBe(false);
  });

  it('keeps the saved password for the same server and user, and asks for one for another user', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    await as('PUT', '/api/ceo/mail', POSTMARK);
    expect((await as('PUT', '/api/ceo/mail', { ...POSTMARK, pass: '', from: 'Vidalune <hello@vidalune.com>' })).statusCode).toBe(200);
    expect(verified.at(-1)).toMatchObject({ pass: 'server-token-1234', from: 'Vidalune <hello@vidalune.com>' });
    expect((await as('PUT', '/api/ceo/mail', { ...POSTMARK, user: 'other-token', pass: '' })).json().error).toMatch(/password/);
  });

  it('keeps the saved user and password when both are left empty, for the same server only', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    await as('PUT', '/api/ceo/mail', POSTMARK);
    const { user: _user, pass: _pass, ...rest } = POSTMARK;
    expect((await as('PUT', '/api/ceo/mail', { ...rest, from: 'Vidalune <hello@vidalune.com>' })).statusCode).toBe(200);
    expect(verified.at(-1)).toMatchObject({ user: 'server-token-1234', pass: 'server-token-1234', from: 'Vidalune <hello@vidalune.com>' });
    // Another server: the saved user and password belong to the old one.
    await as('PUT', '/api/ceo/mail', { ...rest, host: 'smtp-relay.brevo.com' });
    expect(verified.at(-1)).toMatchObject({ host: 'smtp-relay.brevo.com', user: '', pass: '' });
  });

  it('says in the log where mail goes, also after a change in the Control Center', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    expect(cloud.mailStatus()).toMatch(/^Mail: not set up/);
    const as = await ceo();
    await as('PUT', '/api/ceo/mail', POSTMARK);
    expect(cloud.mailStatus()).toBe('Mail: set up in the Control Center: sent as Vidalune <no-reply@vidalune.com> through smtp.postmarkapp.com:587');
    expect(cloud.mailStatus()).not.toContain('server-token');
  });

  it('refuses a wrong header or sender', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    expect((await as('PUT', '/api/ceo/mail', { ...POSTMARK, headers: 'X-PM-Message-Stream outbound' })).json().error).toMatch(/Not a valid header/);
    expect((await as('PUT', '/api/ceo/mail', { ...POSTMARK, from: 'no-reply' })).statusCode).toBe(400);
    expect((await as('PUT', '/api/ceo/mail', { ...POSTMARK, host: 'smtp postmark' })).statusCode).toBe(400);
    expect(verified).toHaveLength(0);
  });

  it('sends a test email to the CEO right away, and says when it fails', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    expect((await as('POST', '/api/ceo/mail/test', {})).statusCode).toBe(400);
    await as('PUT', '/api/ceo/mail', POSTMARK);
    expect((await as('POST', '/api/ceo/mail/test', {})).json()).toEqual({ sentTo: 'boss@example.com' });
    expect(sent.at(-1)).toMatchObject({ to: 'boss@example.com', subject: 'Test email from Vidalune' });
    transportError = new Error('550 Sender signature not confirmed');
    const failed = await as('POST', '/api/ceo/mail/test', {});
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toContain('550 Sender signature not confirmed');
  });

  it('comes before SMTP settings in the environment, which count again once it is removed', async () => {
    await start({ adminEmails: ['boss@example.com'] });
    const as = await ceo();
    db.update(accounts).set({ emailVerifiedAt: clock }).run();
    expect((await as('GET', '/api/ceo/mail')).json()).toMatchObject({ configured: true, source: 'environment', host: 'smtp.example.com' });
    await as('PUT', '/api/ceo/mail', POSTMARK);
    expect((await as('GET', '/api/ceo/mail')).json()).toMatchObject({ source: 'settings', host: 'smtp.postmarkapp.com' });
    expect((await as('DELETE', '/api/ceo/mail')).json()).toMatchObject({ source: 'environment', host: 'smtp.example.com' });
  });

  it('without any settings, nothing is sent', async () => {
    await start({ mail: null, adminEmails: ['boss@example.com'] });
    const as = await ceo();
    await as('PUT', '/api/ceo/mail', POSTMARK);
    expect((await as('DELETE', '/api/ceo/mail')).json()).toMatchObject({ configured: false });
    const before = sent.length;
    await signUp('ann@example.com');
    expect(sent).toHaveLength(before);
  });
});

describe('the mailer', () => {
  it('tries again, then logs the subject without the message (it holds a link)', async () => {
    const logged: string[] = [];
    let calls = 0;
    const mailer = new Mailer(() => ({ config: MAIL, transport: async () => {
      calls++;
      throw new Error('connection refused');
    } }), [0, 0, 0], (m) => logged.push(m));
    mailer.send({ to: 'a@example.com', subject: 'Set a new password', text: 'https://vidalune.com/reset#secret', html: '' });
    await mailer.idle();
    expect(calls).toBe(3);
    expect(logged).toEqual(['Mail "Set a new password" could not be sent: connection refused']);
  });

  it('escapes addresses in the HTML and keeps a plain-text version with the link', () => {
    const m = mailTemplates.changeEmail('en', 'https://vidalune.com/email#abc', '<b>x</b>@example.com');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;@example.com');
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.text).toContain('https://vidalune.com/email#abc');
  });

  it('reads its settings from the environment; nothing without a host and sender', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-mailcfg-'));
    try {
      expect(loadConfig({ DATA_DIR: d }).mail).toBeNull();
      expect(loadConfig({ DATA_DIR: d, SMTP_HOST: 'smtp.example.com' }).mail).toBeNull();
      expect(loadConfig({ DATA_DIR: d, SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'Vidalune <no-reply@vidalune.com>', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_HEADERS: 'X-PM-Message-Stream: outbound' }).mail).toEqual({ host: 'smtp.example.com', port: 587, secure: false, user: 'u', pass: 'p', from: 'Vidalune <no-reply@vidalune.com>', headers: { 'X-PM-Message-Stream': 'outbound' } });
      expect(loadConfig({ DATA_DIR: d, SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', MAIL_FROM: 'x@example.com' }).mail?.secure).toBe(true);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('accepts only well-formed extra headers', () => {
    expect(parseMailHeaders('X-PM-Message-Stream: outbound; X-Tag: a:b')).toEqual({ 'X-PM-Message-Stream': 'outbound', 'X-Tag': 'a:b' });
    expect(parseMailHeaders('Bad Name: x; :nothing; Empty:')).toEqual({});
    expect(parseMailHeaders(undefined)).toEqual({});
  });
});
