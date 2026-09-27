import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP baseline parameters, as on Vidalune servers.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// A real hash so that unknown addresses cost the same as wrong passwords.
let dummy: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<false> {
  dummy ??= hashPassword('vidalune-timing-equaliser');
  await verifyPassword(await dummy, password);
  return false;
}

/** Random token for a session or a server secret (URL-safe). */
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Tokens and codes are stored as hashes only. */
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

// No 0/O, 1/I/L: easy to read out and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** "K7F3-Q9MA": what a server shows and a person enters. */
export function newLinkCode(): string {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** What someone typed ("k7f3 q9ma") in the form the code was made. */
export function normalizeLinkCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
}
