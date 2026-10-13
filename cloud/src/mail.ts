import nodemailer from 'nodemailer';
import type { MailConfig } from './config.js';

export type MailLanguage = 'en' | 'nl';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Delivers one message; throws when the SMTP service refused it or could not be reached. */
export type MailTransport = (message: MailMessage & { from: string; headers: Record<string, string> }) => Promise<void>;

export function smtpTransport(config: MailConfig): MailTransport {
  const transporter = nodemailer.createTransport({
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
  return async (m) => {
    await transporter.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers });
  };
}

const DELAYS_MS = [0, 5_000, 30_000];

/**
 * Sends the account service's mail in the background, so a request never waits for the SMTP
 * service: a few attempts, then it is logged (without the message itself, which holds a link).
 */
export class Mailer {
  private pending = new Set<Promise<void>>();
  constructor(
    private readonly config: Pick<MailConfig, 'from' | 'headers'>,
    private readonly transport: MailTransport,
    private readonly delays: number[] = DELAYS_MS,
    private readonly log: (message: string) => void = (message) => console.warn(message),
  ) {}

  send(message: MailMessage): void {
    const job = this.deliver(message).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Waits until everything handed over was sent or given up (tests, shutting down). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async deliver(message: MailMessage): Promise<void> {
    let last: unknown;
    for (const delay of this.delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        await this.transport({ ...message, from: this.config.from, headers: this.config.headers });
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
};
