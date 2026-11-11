import { hash, verify, type Options } from '@node-rs/argon2';

// Argon2id (the library default) with OWASP's minimum recommended settings:
// 19 MiB memory, 2 iterations, 1 lane.
const ARGON2_OPTIONS: Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string): Promise<string> =>
  hash(password, ARGON2_OPTIONS);

export const verifyPassword = (
  passwordHash: string,
  password: string,
): Promise<boolean> => verify(passwordHash, password);
