import { createHash, randomBytes } from 'node:crypto';

/**
 * For high-entropy secrets we generate ourselves (API keys, refresh tokens).
 * A fast hash is safe there and allows lookup by hash. Never use it for
 * passwords; those go through Argon2id.
 */
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** 256 bits of randomness, URL-safe. */
export const randomToken = (prefix = ''): string =>
  `${prefix}${randomBytes(32).toString('base64url')}`;
