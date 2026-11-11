// Lotus Demo Bank: a fictional bank website that uses the Security Alerts
// API as its security layer. No dependencies; Node 22+.
//
// On every login it:
//   1. asks POST /firewall/check whether the visitor's IP is blocked,
//   2. checks the password against its own (fake) user list,
//   3. reports a failed login as an alert with POST /alerts.
// The API does the rest: the rule engine escalates repeated failures, a
// notification goes out, and the firewall blocks the IP. Step 1 then turns
// that visitor away here too.

import { createServer } from 'node:http';
import { isIP } from 'node:net';

const PORT = Number(process.env.PORT ?? 4000);
const API_URL = (
  process.env.SECURITY_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const API_KEY = process.env.SECURITY_API_KEY ?? '';
// If the security API is down: let people in (false) or turn everyone away (true).
const FAIL_CLOSED = process.env.FAIL_CLOSED === 'true';
const API_TIMEOUT_MS = 3_000;

// Demo accounts. A real bank keeps hashed passwords in a database.
const USERS = new Map([
  ['dara', 'lotus-demo-123'],
  ['sokha', 'lotus-demo-456'],
]);

if (!API_KEY) {
  console.warn(
    '[bank] SECURITY_API_KEY is not set: run "npm run demo:setup" in the API project, then restart.',
  );
}

/** Calls the Security Alerts API with this app's source key. */
async function securityApi(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

async function isBlocked(ip) {
  try {
    return (await securityApi('/firewall/check', { ip })).blocked;
  } catch (error) {
    console.error(
      `[bank] firewall check failed (${error.message}); failing ${FAIL_CLOSED ? 'closed' : 'open'}`,
    );
    return FAIL_CLOSED;
  }
}

async function reportFailedLogin(username, ip) {
  try {
    await securityApi('/alerts', {
      title: `Failed login for "${username}" on Lotus Demo Bank`.slice(0, 200),
      type: 'failed_login',
      severity: 'low',
      ipAddress: ip,
      payload: {
        app: 'lotus-demo-bank',
        username: username.slice(0, 64),
        knownUser: USERS.has(username),
      },
    });
  } catch (error) {
    // Never let reporting break the login page.
    console.error(`[bank] could not report failed login: ${error.message}`);
  }
}

/**
 * The visitor's IP. Everyone hits this demo from the same machine, so the
 * form lets the presenter pretend to be a different visitor. A real app
 * would use the connection address (or its trusted proxy's header).
 */
function visitorIp(req, form) {
  const simulated = (form.get('simulatedIp') ?? '').trim();
  if (isIP(simulated)) return simulated;
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Lotus Demo Bank</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f1ea;color:#1d2b24;margin:0;display:grid;place-items:center;min-height:100vh}
  main{background:#fff;padding:2rem 2.25rem;border-radius:12px;box-shadow:0 2px 14px #0002;width:min(380px,90vw)}
  h1{margin:0 0 .25rem;font-size:1.4rem} .sub{margin:0 0 1.5rem;color:#5b6b62;font-size:.9rem}
  label{display:block;font-size:.85rem;margin:.75rem 0 .25rem} input{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9cfc9;border-radius:6px;font:inherit}
  button{margin-top:1.25rem;width:100%;padding:.65rem;border:0;border-radius:6px;background:#1f6f4a;color:#fff;font:inherit;cursor:pointer}
  .msg{padding:.75rem;border-radius:6px;margin-bottom:1rem;font-size:.9rem} .err{background:#fde8e8;color:#8a1c1c} .ok{background:#e5f4ea;color:#1f5b3a} .blocked{background:#2b1d1d;color:#ffd7d7}
  .demo{margin-top:1.5rem;padding-top:1rem;border-top:1px dashed #c9cfc9;font-size:.8rem;color:#5b6b62} a{color:#1f6f4a}
</style></head><body><main>${body}</main></body></html>`;
}

function loginPage({
  message = '',
  kind = 'err',
  username = '',
  ip = '203.0.113.10',
} = {}) {
  return page(
    'Sign in',
    `<h1>🪷 Lotus Demo Bank</h1><p class="sub">Fictional bank, protected by the Security Alerts API</p>
    ${message ? `<div class="msg ${kind}">${message}</div>` : ''}
    <form method="post" action="/login">
      <label for="u">Username</label><input id="u" name="username" value="${escapeHtml(username)}" required autocomplete="username">
      <label for="p">Password</label><input id="p" name="password" type="password" required autocomplete="current-password">
      <div class="demo">
        <label for="ip">Demo only: pretend to be a visitor from IP</label>
        <input id="ip" name="simulatedIp" value="${escapeHtml(ip)}">
        Demo accounts: dara / lotus-demo-123, sokha / lotus-demo-456
      </div>
      <button>Sign in</button>
    </form>`,
  );
}

async function readForm(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('form too large');
  }
  return new URLSearchParams(raw);
}

function send(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

async function handleLogin(req, res) {
  const form = await readForm(req);
  const username = (form.get('username') ?? '').trim().toLowerCase();
  const password = form.get('password') ?? '';
  const ip = visitorIp(req, form);

  if (await isBlocked(ip)) {
    console.log(`[bank] refused ${ip}: blocked by the security service`);
    return send(
      res,
      403,
      page(
        'Access blocked',
        `<h1>🪷 Lotus Demo Bank</h1><div class="msg blocked">⛔ Access from <b>${escapeHtml(ip)}</b> has been blocked by our security service.</div>
        <p class="sub">If this is a mistake, contact the bank. <a href="/">Back</a></p>`,
      ),
    );
  }

  if (USERS.get(username) !== password) {
    console.log(`[bank] failed login for "${username}" from ${ip}`);
    await reportFailedLogin(username, ip);
    // Same message whether or not the username exists.
    return send(
      res,
      401,
      loginPage({ message: 'Wrong username or password.', username, ip }),
    );
  }

  console.log(`[bank] ${username} signed in from ${ip}`);
  return send(
    res,
    200,
    page(
      'Welcome',
      `<h1>🪷 Welcome, ${escapeHtml(username)}</h1><div class="msg ok">Signed in from ${escapeHtml(ip)}.</div>
      <p class="sub">Balance: $1,234.56 (not real money)</p><p><a href="/">Sign out</a></p>`,
    ),
  );
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/login'))
      return send(res, 200, loginPage());
    if (req.method === 'POST' && req.url === '/login')
      return await handleLogin(req, res);
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"status":"ok"}');
    }
    send(
      res,
      404,
      page('Not found', '<h1>Not found</h1><p><a href="/">Home</a></p>'),
    );
  } catch (error) {
    console.error(`[bank] ${error.message}`);
    send(
      res,
      500,
      page('Error', '<h1>Something went wrong</h1><p><a href="/">Home</a></p>'),
    );
  }
});

server.listen(PORT, () =>
  console.log(
    `[bank] Lotus Demo Bank on http://localhost:${PORT} (security API: ${API_URL})`,
  ),
);
