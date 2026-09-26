import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended baseline parameters (19 MiB, 2 iterations, 1 lane).
// Chosen so a login stays well under 100 ms even on old dual-core CPUs.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password must be at most 256 characters.';
  if (password.trim().length === 0) return 'Password cannot be only whitespace.';
  return null;
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(username ?? '')) {
    return 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.';
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// A real hash so that unknown usernames cost the same as wrong passwords (timing safety).
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('velyx-timing-equaliser');
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}
