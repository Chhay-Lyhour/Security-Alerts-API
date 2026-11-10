const PLACEHOLDER_SECRETS = new Set(['change_me_to_a_long_random_string']);
const MIN_JWT_SECRET_LENGTH = 32;

type RawEnv = Record<string, unknown>;

const text = (env: RawEnv, key: string): string | undefined => {
  const value = env[key];
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const checkPositiveInt = (env: RawEnv, key: string, errors: string[]) => {
  const value = text(env, key);
  if (value !== undefined && !/^[1-9]\d*$/.test(value)) {
    errors.push(`${key} must be a positive integer`);
  }
};

/**
 * Runs once at startup via ConfigModule. The app refuses to boot with weak or
 * malformed security settings instead of running insecurely.
 */
export const validateEnv = (env: RawEnv): RawEnv => {
  const errors: string[] = [];

  const jwtSecret = text(env, 'JWT_SECRET');
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (PLACEHOLDER_SECRETS.has(jwtSecret)) {
    errors.push('JWT_SECRET is still the example placeholder; generate a real one');
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  checkPositiveInt(env, 'JWT_ACCESS_EXPIRES_IN_SECONDS', errors);
  checkPositiveInt(env, 'REFRESH_TOKEN_TTL_DAYS', errors);

  // Admins are created with `npm run seed:admin`, not from env vars. Fail
  // loudly if the old variables are still set, so a password isn't left
  // sitting in .env doing nothing.
  for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
    if (text(env, key) !== undefined) {
      errors.push(`${key} is no longer used; remove it and run "npm run seed:admin" instead`);
    }
  }

  const trustProxy = text(env, 'TRUST_PROXY');
  if (trustProxy !== undefined && !/^\d+$/.test(trustProxy)) {
    errors.push('TRUST_PROXY must be the number of proxy hops in front of the app (e.g. 1)');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return env;
};
