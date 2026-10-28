import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MailConfig } from './config.js';
import type { DB } from './db/client.js';
import { serviceSettings } from './db/schema.js';

export type MailLanguage = 'en' | 'nl';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Delivers one message; throws when the SMTP service refused it or could not be reached. */
export type MailTransport = (message: MailMessage & { from: string; headers: Record<string, string> }) => Promise<void>;

const transporterFor = (config: MailConfig) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Without TLS from the start, the connection must still be encrypted (STARTTLS) before signing in.
    requireTLS: !config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

export function smtpTransport(config: MailConfig): MailTransport {
  const transporter = transporterFor(config);
  return async (m) => {
    await transporter.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers });
  };
}

/** Connects and signs in at the SMTP service without sending anything; throws with its reason. */
export async function smtpVerify(config: MailConfig): Promise<void> {
  const transporter = transporterFor(config);
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

/**
 * Where mail goes: the settings saved in the Control Center (stored in the database, the password
 * never shown again), else SMTP_* from the environment, else nowhere.
 */
export class MailSettings {
  private saved: MailConfig | null | undefined;
  constructor(
    private readonly db: DB,
    private readonly fallback: MailConfig | null,
    private readonly now: () => number = Date.now,
  ) {}

  stored(): MailConfig | null {
    if (this.saved === undefined) {
      const row = this.db.select().from(serviceSettings).where(eq(serviceSettings.key, 'mail')).get();
      this.saved = row ? (JSON.parse(row.value) as MailConfig) : null;
    }
    return this.saved;
  }

  current(): { config: MailConfig; source: 'settings' | 'environment' } | null {
    const stored = this.stored();
    if (stored) return { config: stored, source: 'settings' };
    return this.fallback ? { config: this.fallback, source: 'environment' } : null;
  }

  /** One line for the log: where mail goes now (without the user or password). */
  describe(): string {
    const current = this.current();
    if (!current) return 'Mail: not set up (Control Center > Mail, or SMTP_HOST and MAIL_FROM); confirmation and password emails are not sent';
    const where = current.source === 'settings' ? 'set up in the Control Center' : 'set up in the environment';
    return `Mail: ${where}: sent as ${current.config.from} through ${current.config.host}:${current.config.port}`;
  }

  /**
   * Whether mail was ever set up here (in the Control Center or the environment). From then on an
   * address only brings rights once it is confirmed, also if mail is turned off again later.
   */
  everSetUp(): boolean {
    if (this.ever) return true;
    if (this.current()) this.remember();
    this.ever = !!this.db.select().from(serviceSettings).where(eq(serviceSettings.key, 'mail-ever')).get();
    return this.ever;
  }

  private ever = false;

  private remember(): void {
    this.ever = true;
    this.db.insert(serviceSettings).values({ key: 'mail-ever', value: '1', updatedAt: this.now(), updatedBy: 'system' }).onConflictDoNothing().run();
  }

  save(config: MailConfig | null, by: string): void {
    if (config) this.remember();
    if (config) {
      const value = JSON.stringify(config);
      this.db.insert(serviceSettings).values({ key: 'mail', value, updatedAt: this.now(), updatedBy: by }).onConflictDoUpdate({ target: serviceSettings.key, set: { value, updatedAt: this.now(), updatedBy: by } }).run();
    } else {
      this.db.delete(serviceSettings).where(eq(serviceSettings.key, 'mail')).run();
    }
    this.saved = config;
  }
}

const DELAYS_MS = [0, 5_000, 30_000];

/** What sending needs right now (null: no mail set up). */
export type MailRoute = { config: Pick<MailConfig, 'from' | 'headers'>; transport: MailTransport } | null;

/**
 * Sends the account service's mail in the background, so a request never waits for the SMTP
 * service: a few attempts, then it is logged (without the message itself, which holds a link).
 */
export class Mailer {
  private pending = new Set<Promise<void>>();
  constructor(
    private readonly route: () => MailRoute,
    private readonly delays: number[] = DELAYS_MS,
    private readonly log: (message: string) => void = (message) => console.warn(message),
  ) {}

  /** Whether mail can be sent (an SMTP service is set up). */
  get enabled(): boolean {
    return this.route() !== null;
  }

  /** Hands a message over to be sent in the background (nothing when no mail is set up). */
  send(message: MailMessage): void {
    const route = this.route();
    if (!route) return;
    const job = this.deliver(message, route.config, route.transport).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Waits until everything handed over was sent or given up (tests, shutting down). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async deliver(message: MailMessage, config: Pick<MailConfig, 'from' | 'headers'>, transport: MailTransport): Promise<void> {
    let last: unknown;
    for (const delay of this.delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        await transport({ ...message, from: config.from, headers: config.headers });
        return;
      } catch (err) {
        last = err;
      }
    }
    this.log(`Mail "${message.subject}" could not be sent: ${(last as Error)?.message ?? last}`);
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A message with one button: the same text as plain text and as simple HTML (no images, no tracking). */
function layout(lang: MailLanguage, subject: string, paragraphs: string[], action: { label: string; url: string } | null, footer: string): MailMessage & { to: '' } {
  const text = [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), '', footer].join('\n\n');
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#d9d6e8">${escapeHtml(t)}</p>`;
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#b69cff;color:#16131f;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(action.label)}</a></p>` +
      p(lang === 'nl' ? 'Werkt de knop niet? Kopieer deze link in je browser:' : 'Button not working? Copy this link into your browser:') +
      `<p style="margin:0 0 16px;font-size:13px;word-break:break-all;color:#b69cff">${escapeHtml(action.url)}</p>`
    : '';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;background:#12101a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
    `<div style="max-width:520px;margin:0 auto;padding:32px 20px">` +
    `<p style="margin:0 0 28px;font-size:20px;font-weight:700;color:#ffffff">vidalune</p>` +
    paragraphs.map(p).join('') + button +
    `<p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#8a85a0">${escapeHtml(footer)}</p>` +
    `</div></body></html>`;
  return { to: '', subject, text, html };
}

const FOOTER: Record<MailLanguage, string> = {
  en: 'You get this message because of your Vidalune account. Vidalune never asks for your password by email.',
  nl: 'Je krijgt dit bericht vanwege je Vidalune-account. Vidalune vraagt nooit om je wachtwoord per e-mail.',
};

/** The account service's messages, in English and Dutch. */
export const mailTemplates = {
  verify: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Bevestig je e-mailadres', ['Welkom bij Vidalune! Bevestig je e-mailadres, zodat je je account altijd terugkrijgt als je je wachtwoord vergeet.', 'De link werkt 2 dagen.'], { label: 'E-mailadres bevestigen', url }, `${FOOTER.nl} Heb je geen account gemaakt? Dan kun je dit bericht negeren.`)
      : layout(lang, 'Confirm your email address', ['Welcome to Vidalune! Confirm your email address, so you can always get back into your account if you forget your password.', 'The link works for 2 days.'], { label: 'Confirm email address', url }, `${FOOTER.en} Did not create an account? You can ignore this message.`),
  reset: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Nieuw wachtwoord instellen', ['Iemand vroeg een nieuw wachtwoord aan voor je Vidalune-account. Was jij dat? Kies dan hieronder een nieuw wachtwoord. Je wordt daarna overal afgemeld.', 'De link werkt 1 uur.'], { label: 'Nieuw wachtwoord kiezen', url }, `${FOOTER.nl} Heb jij dit niet gevraagd? Dan kun je dit bericht negeren; je wachtwoord blijft hetzelfde.`)
      : layout(lang, 'Set a new password', ['Someone asked for a new password for your Vidalune account. Was it you? Then choose a new password below. You are signed out everywhere afterwards.', 'The link works for 1 hour.'], { label: 'Choose a new password', url }, `${FOOTER.en} Did not ask for this? You can ignore this message; your password stays the same.`),
  /** A Vidalune account made for someone (by Vidalune), taken over with a password of their own. */
  claim: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Je Vidalune-account activeren', ['Er staat al een Vidalune-account klaar voor dit e-mailadres. Kies een wachtwoord om het te gebruiken.', 'De link werkt 1 uur.'], { label: 'Wachtwoord kiezen', url }, `${FOOTER.nl} Heb jij dit niet gevraagd? Dan kun je dit bericht negeren.`)
      : layout(lang, 'Activate your Vidalune account', ['A Vidalune account is ready for this email address. Choose a password to start using it.', 'The link works for 1 hour.'], { label: 'Choose a password', url }, `${FOOTER.en} Did not ask for this? You can ignore this message.`),
  changeEmail: (lang: MailLanguage, url: string, oldEmail: string) =>
    lang === 'nl'
      ? layout(lang, 'Bevestig je nieuwe e-mailadres', [`Je wilt het e-mailadres van je Vidalune-account wijzigen van ${oldEmail} naar dit adres. Bevestig het om de wijziging af te ronden.`, 'De link werkt 1 dag.'], { label: 'Nieuw adres bevestigen', url }, `${FOOTER.nl} Heb jij dit niet gevraagd? Dan kun je dit bericht negeren.`)
      : layout(lang, 'Confirm your new email address', [`You want to change the email address of your Vidalune account from ${oldEmail} to this address. Confirm it to finish the change.`, 'The link works for 1 day.'], { label: 'Confirm new address', url }, `${FOOTER.en} Did not ask for this? You can ignore this message.`),
  emailChanged: (lang: MailLanguage, newEmail: string, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Je e-mailadres is gewijzigd', [`Het e-mailadres van je Vidalune-account is gewijzigd naar ${newEmail}. Je logt voortaan met dat adres in.`, 'Was jij dit niet? Neem dan meteen contact op met Vidalune via info@vidalune.com.'], { label: 'Naar je account', url }, FOOTER.nl)
      : layout(lang, 'Your email address was changed', [`The email address of your Vidalune account was changed to ${newEmail}. From now on you sign in with that address.`, 'Was this not you? Contact Vidalune right away at info@vidalune.com.'], { label: 'Go to your account', url }, FOOTER.en),
  passwordChanged: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Je wachtwoord is gewijzigd', ['Het wachtwoord van je Vidalune-account is zojuist gewijzigd.', 'Was jij dit niet? Kies dan meteen een nieuw wachtwoord via "Wachtwoord vergeten?" en neem contact op met Vidalune via info@vidalune.com.'], { label: 'Naar je account', url }, FOOTER.nl)
      : layout(lang, 'Your password was changed', ['The password of your Vidalune account was just changed.', 'Was this not you? Choose a new password right away with "Forgot password?" and contact Vidalune at info@vidalune.com.'], { label: 'Go to your account', url }, FOOTER.en),
  tvSignedIn: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Er is een tv ingelogd met je account', ['Zojuist is een tv met de Vidalune-app ingelogd met je Vidalune-account, met een code die je op vidalune.com/tv bevestigde.', 'Was jij dit niet? Wijzig dan meteen je wachtwoord op je accountpagina: alle andere apparaten, ook die tv, worden dan afgemeld. Neem contact op met Vidalune via info@vidalune.com.'], { label: 'Naar je account', url }, FOOTER.nl)
      : layout(lang, 'A TV signed in with your account', ['A TV with the Vidalune app just signed in with your Vidalune account, with a code you confirmed on vidalune.com/tv.', 'Was this not you? Change your password on your account page right away: all other devices, that TV too, are then signed out. Contact Vidalune at info@vidalune.com.'], { label: 'Go to your account', url }, FOOTER.en),
  test: (lang: MailLanguage, url: string) =>
    lang === 'nl'
      ? layout(lang, 'Testmail van Vidalune', ['Dit is een testmail uit het Control Center. Komt hij aan, dan werkt de mail van vidalune.com.'], { label: 'Naar het Control Center', url }, FOOTER.nl)
      : layout(lang, 'Test email from Vidalune', ['This is a test email from the Control Center. If it arrives, the mail of vidalune.com works.'], { label: 'Go to the Control Center', url }, FOOTER.en),
};

export class MailSettingsError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** The Control Center's mail settings: write-only for the password, checked at the SMTP service before saving. */
export function mailRoutes(
  app: FastifyInstance,
  deps: {
    settings: MailSettings;
    ceo: (request: FastifyRequest) => { id: number; email: string };
    /** Counts the CEO's own address as confirmed. */
    confirmSelf: (me: { id: number }) => void;
    limit: (key: string) => void;
    verify: (config: MailConfig) => Promise<void>;
    /** Sends one message now (not in the background), so the Control Center hears whether it worked. */
    sendNow: (config: MailConfig, message: MailMessage) => Promise<void>;
    language: (request: FastifyRequest) => MailLanguage;
    log: (message: string) => void;
    controlCenterUrl: string;
  },
) {
  const host = z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/i, 'Enter the name of the SMTP server, such as smtp.postmarkapp.com.');
  const body = z.object({
    host,
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    /** Empty: keep the saved user (for the same server). */
    user: z.string().trim().max(200).default(''),
    /** Empty: keep the saved password. */
    pass: z.string().max(500).optional(),
    from: z.string().trim().min(3).max(200).refine((v) => /@[^\s@>]+\.[^\s@>]+/.test(v) && !/[\r\n]/.test(v), 'Enter the sender, such as Vidalune <no-reply@vidalune.com>.'),
    headers: z.string().max(500).default(''),
  });
  const view = () => {
    const current = deps.settings.current();
    const c = current?.config;
    return {
      configured: !!c,
      source: current?.source ?? null,
      host: c?.host ?? '',
      port: c?.port ?? 587,
      secure: c?.secure ?? false,
      // At Postmark and similar services the user is a token as well: only its end is shown.
      hasUser: !!c?.user,
      userHint: c?.user ? `••••${c.user.slice(-4)}` : null,
      from: c?.from ?? '',
      headers: c ? Object.entries(c.headers).map(([k, v]) => `${k}: ${v}`).join('; ') : '',
      // Never the password itself.
      hasPassword: !!c?.pass,
      hint: c?.pass ? `••••${c.pass.slice(-4)}` : null,
    };
  };
  const fail = (err: unknown): never => {
    throw new MailSettingsError(400, `The SMTP service did not accept this: ${(err as Error)?.message ?? err}`);
  };
  app.get('/api/ceo/mail', async (request) => {
    deps.ceo(request);
    return view();
  });
  app.put('/api/ceo/mail', async (request) => {
    const me = deps.ceo(request);
    deps.limit(`mail-settings:${me.email}`);
    const b = body.parse(request.body);
    const stored = deps.settings.stored();
    const headers = parseMailHeadersStrict(b.headers);
    const host = b.host.toLowerCase();
    // No user given: the saved one, for the same server. A new server or user without a password: the old password belongs to the old one.
    const user = b.user || (stored && stored.host === host ? stored.user : '');
    const sameAccount = stored && stored.host === host && stored.user === user;
    const next: MailConfig = { host, port: b.port, secure: b.secure, user, pass: b.pass || (sameAccount ? stored.pass : ''), from: b.from, headers };
    if (next.user && !next.pass) throw new MailSettingsError(400, 'Enter the password (or token) for this SMTP user.');
    await deps.verify(next).catch(fail);
    deps.settings.save(next, me.email);
    deps.log(`Mail: set up in the Control Center by ${me.email}: sent as ${next.from} through ${next.host}:${next.port}`);
    // Whoever turns mail on keeps the Control Center (rights now need a confirmed address).
    deps.confirmSelf(me);
    return view();
  });
  app.delete('/api/ceo/mail', async (request) => {
    const me = deps.ceo(request);
    deps.settings.save(null, me.email);
    const fallback = deps.settings.current();
    deps.log(fallback ? `Mail: turned off in the Control Center by ${me.email}; the environment's settings are used (${fallback.config.host})` : `Mail: turned off in the Control Center by ${me.email}; no mail is sent`);
    return view();
  });
  /** A test email to the signed-in CEO, sent right away, with the SMTP service's answer when it fails. */
  app.post('/api/ceo/mail/test', async (request) => {
    const me = deps.ceo(request);
    deps.limit(`mail-test:${me.email}`);
    z.object({ lang: z.enum(['en', 'nl']).optional() }).parse(request.body ?? {});
    const current = deps.settings.current();
    if (!current) throw new MailSettingsError(400, 'Set up mail first.');
    await deps.sendNow(current.config, { ...mailTemplates.test(deps.language(request), deps.controlCenterUrl), to: me.email }).catch((err) => {
      throw new MailSettingsError(502, `The test email was not sent: ${(err as Error)?.message ?? err}`);
    });
    return { sentTo: me.email };
  });
}

/** Like parseMailHeaders, but says which part is wrong instead of leaving it out. */
function parseMailHeadersStrict(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const part of value.split(';').map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const name = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (i <= 0 || !/^[A-Za-z0-9-]{1,64}$/.test(name) || !v || /[\r\n]/.test(v)) throw new MailSettingsError(400, `Not a valid header: "${part}". Write it as Name: value, separated by ;.`);
    headers[name] = v;
  }
  return headers;
}
