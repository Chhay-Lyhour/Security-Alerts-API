import { validateEnv } from './env.validation.js';

const goodSecret = 'a'.repeat(48);

describe('validateEnv', () => {
  it('accepts a valid configuration', () => {
    expect(() =>
      validateEnv({
        JWT_SECRET: goodSecret,
        JWT_ACCESS_EXPIRES_IN_SECONDS: '900',
        REFRESH_TOKEN_TTL_DAYS: '7',
        TRUST_PROXY: '1',
      }),
    ).not.toThrow();
  });

  it('treats empty ADMIN_* values as unset', () => {
    expect(() =>
      validateEnv({ JWT_SECRET: goodSecret, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }),
    ).not.toThrow();
  });

  it.each([
    [{}, 'JWT_SECRET is required'],
    [{ JWT_SECRET: 'short' }, 'at least 32 characters'],
    [{ JWT_SECRET: 'change_me_to_a_long_random_string' }, 'placeholder'],
  ])('rejects a missing, short or placeholder JWT secret', (env, message) => {
    expect(() => validateEnv(env)).toThrow(message);
  });

  it.each(['ADMIN_EMAIL', 'ADMIN_PASSWORD'])(
    'rejects the retired %s variable and points to seed:admin',
    (key) => {
      expect(() => validateEnv({ JWT_SECRET: goodSecret, [key]: 'x' })).toThrow(
        'npm run seed:admin',
      );
    },
  );

  it.each(['true', '-1', 'abc'])('rejects TRUST_PROXY=%s', (value) => {
    expect(() => validateEnv({ JWT_SECRET: goodSecret, TRUST_PROXY: value })).toThrow(
      'TRUST_PROXY',
    );
  });

  it('rejects non-numeric token lifetimes', () => {
    expect(() =>
      validateEnv({ JWT_SECRET: goodSecret, REFRESH_TOKEN_TTL_DAYS: '7d' }),
    ).toThrow('REFRESH_TOKEN_TTL_DAYS must be a positive integer');
  });

  it('accepts valid firewall and migration settings', () => {
    expect(() =>
      validateEnv({
        JWT_SECRET: goodSecret,
        FIREWALL_AUTO_BLOCK_MINUTES: '0',
        FIREWALL_ALLOWLIST: '10.0.0.0/8, 192.0.2.1,::1',
        DATABASE_RUN_MIGRATIONS: 'true',
      }),
    ).not.toThrow();
  });

  it.each([
    [{ FIREWALL_AUTO_BLOCK_MINUTES: '-5' }, 'FIREWALL_AUTO_BLOCK_MINUTES'],
    [{ FIREWALL_AUTO_BLOCK_MINUTES: '1h' }, 'FIREWALL_AUTO_BLOCK_MINUTES'],
    [{ FIREWALL_ALLOWLIST: '10.0.0.0/8,office' }, 'FIREWALL_ALLOWLIST: "office"'],
    [{ DATABASE_RUN_MIGRATIONS: 'yes' }, 'DATABASE_RUN_MIGRATIONS'],
  ])('rejects bad firewall or migration settings: %o', (env, message) => {
    expect(() => validateEnv({ JWT_SECRET: goodSecret, ...env })).toThrow(message);
  });
});
