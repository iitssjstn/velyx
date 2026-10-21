/**
 * Signing in the app on a TV (Android TV / Google TV) with a code instead of typing a password with
 * the remote: the TV shows a code and a QR code; on a phone or computer, signed in on vidalune.com,
 * the code is entered (the QR code opens that page with the code filled in), and the TV, asking
 * every few seconds, is then signed in with that account.
 */
import qrcode from 'qrcode-generator';

/** What vidalune.com gives the TV: the code to show, its own secret to ask with, and how long it works. */
export interface TvCode {
  code: string;
  device: string;
  url: string;
  expiresIn: number;
  interval: number;
}

/** The page on vidalune.com with the code filled in (after "#": never sent to a server log). */
export const tvSignInUrl = (code: Pick<TvCode, 'url' | 'code'>): string => `${code.url}#${code.code}`;

/** The QR code of a text as rows of dark (true) and light modules, to draw square by square. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}
