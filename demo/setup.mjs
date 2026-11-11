// One-time demo setup against the Docker stack (`docker compose up -d --build` first):
//
//   npm run demo:setup
//
// 1. creates the admin account (inside the api container, via seed-admin)
// 2. registers an analyst account
// 3. creates the rule "5 failed_login in 60s -> high"
// 4. registers Lotus Demo Bank as a source and saves its API key to .env
// 5. restarts the bank container so it picks the key up
//
// Safe to run again. Demo passwords can be changed with DEMO_ADMIN_PASSWORD /
// DEMO_ANALYST_PASSWORD; they are for a local demo only.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const API = (
  process.env.SECURITY_API_URL ??
  `http://localhost:${process.env.API_HOST_PORT ?? 3000}`
).replace(/\/$/, '');
const ADMIN = {
  email: 'admin@lotus.demo',
  password: process.env.DEMO_ADMIN_PASSWORD ?? 'demo-admin-password',
};
const ANALYST = {
  email: 'analyst@lotus.demo',
  password: process.env.DEMO_ANALYST_PASSWORD ?? 'demo-analyst-password',
};
const RULE = {
  name: 'Lotus: 5 failed logins in 60s',
  type: 'failed_login',
  threshold: 5,
  windowSeconds: 60,
  severity: 'high',
};
const ENV_FILE = '.env';

const step = (text) => console.log(`\n▶ ${text}`);
const fail = (text) => {
  console.error(`\n✖ ${text}`);
  process.exit(1);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  }).catch((error) =>
    fail(
      `Can't reach the API at ${API} (${error.message}). Is "docker compose up -d" running?`,
    ),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function docker(args, input) {
  const result = spawnSync('docker', ['compose', ...args], {
    input,
    encoding: 'utf8',
  });
  if (result.error)
    fail(`docker compose ${args.join(' ')} failed: ${result.error.message}`);
  return result;
}

function saveEnv(key, value) {
  const lines = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8').split('\n')
    : [];
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'));
}

step(`Checking ${API}/health`);
const health = await call('GET', '/health');
if (health.status !== 200)
  fail(`API is not healthy: ${JSON.stringify(health.body)}`);
console.log('  ok');

step(`Admin account ${ADMIN.email}`);
const seed = docker(
  [
    'exec',
    '-T',
    'api',
    'node',
    'dist/scripts/seed-admin.js',
    '--email',
    ADMIN.email,
  ],
  `${ADMIN.password}\n${ADMIN.password}\n`,
);
console.log(`  ${(seed.stdout || seed.stderr).trim()}`);

const login = await call('POST', '/auth/login', { body: ADMIN });
if (login.status !== 200) {
  fail(
    `Admin login failed (${login.status}). If the admin already existed with another password, set DEMO_ADMIN_PASSWORD.`,
  );
}
const token = login.body.accessToken;

step(`Analyst account ${ANALYST.email}`);
const analyst = await call('POST', '/auth/register', { body: ANALYST });
console.log(
  analyst.status === 201
    ? '  created'
    : analyst.status === 409
      ? '  already exists'
      : `  ${analyst.status}`,
);

step(`Rule "${RULE.name}"`);
const rules = await call('GET', '/rules', { token });
if (rules.body.some?.((rule) => rule.name === RULE.name)) {
  console.log('  already exists');
} else {
  const created = await call('POST', '/rules', { token, body: RULE });
  if (created.status !== 201)
    fail(`Could not create the rule: ${JSON.stringify(created.body)}`);
  console.log('  created');
}

step('Source for Lotus Demo Bank');
const source = await call('POST', '/sources', {
  token,
  body: { name: `lotus-demo-bank ${new Date().toISOString().slice(0, 19)}` },
});
if (source.status !== 201)
  fail(`Could not create the source: ${JSON.stringify(source.body)}`);
saveEnv('BANK_API_KEY', source.body.apiKey);
console.log(
  `  created "${source.body.name}", API key saved to ${ENV_FILE} as BANK_API_KEY`,
);

step('Restarting bank-demo with the new key');
const up = docker(['up', '-d', 'bank-demo']);
if (up.status !== 0) fail(up.stderr);
console.log('  done');

console.log(`
✔ Demo ready
  Bank website:  http://localhost:${process.env.BANK_HOST_PORT ?? 4000}
  API:           ${API}
  Admin:         ${ADMIN.email} / ${ADMIN.password}
  Analyst:       ${ANALYST.email} / ${ANALYST.password}

  Try: sign in to the bank with a wrong password 5 times from the same
  "visitor IP", then once more: that IP is now blocked. See README "Demo".`);
