import type { Params } from './i18n/index.js';

/**
 * An error answered to the client. `message` is English and doubles as the translation key;
 * `params` fill its `{placeholders}` in the user's language.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly params?: Params,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, message);

export function parseId(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.');
  return n;
}
