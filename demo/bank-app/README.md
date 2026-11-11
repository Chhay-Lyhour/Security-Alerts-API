# Lotus Demo Bank

A fictional bank website that uses the Security Alerts API as its security layer. It answers the question "integrated with who?": this is what any real app would do. There are no dependencies; it's a single `server.mjs` running on Node 22+.

On each sign-in it:

1. calls `POST /firewall/check` with the visitor's IP, and refuses them if it's blocked,
2. checks the password against its own demo users,
3. reports a failure with `POST /alerts` (`type: failed_login`, `severity: low`).

Detection, escalation, notification and blocking all happen in the API.

It runs as the `bank-demo` service in `docker-compose.yml` on http://localhost:4000. `npm run demo:setup` creates its API key.

| Variable | Default | |
|---|---|---|
| `SECURITY_API_URL` | `http://localhost:3000` | Where the API is |
| `SECURITY_API_KEY` | | The bank's source API key |
| `FAIL_CLOSED` | `false` | If the API is unreachable: `false` lets visitors in, `true` turns everyone away |
| `PORT` | `4000` | |

Run it outside Docker:

```bash
SECURITY_API_KEY=sa_… node demo/bank-app/server.mjs
```

The "pretend to be a visitor from IP" field exists only because every demo visitor comes from the same laptop. A real app uses the connection's address, or its trusted proxy's `X-Forwarded-For`.
