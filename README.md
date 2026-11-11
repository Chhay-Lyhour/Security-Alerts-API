# Security Alerts API

A security layer that other apps plug into, built with **NestJS**, **PostgreSQL** and **BullMQ/Redis**.

An integrated app (for example a bank's website) sends its security events here. The API stores them and detects attack patterns. It notifies the security team and blocks the attacker's IP. Analysts acknowledge or resolve each alert, and every privileged action goes into a tamper-proof audit trail.

For the full design, see [`SPECS.md`](./SPECS.md). Each area has its own guide in [`docs/`](./docs).

## How it fits together

```
 Visitor ──► Lotus Demo Bank (integrated app, demo/bank-app)
               │ 1. POST /firewall/check   "is this IP blocked?"
               │ 2. POST /alerts           "failed login from 203.0.113.10"
               ▼  (x-api-key)
 ┌──────────────────────── Security Alerts API ────────────────────────┐
 │ Firewall middleware: blocked IPs are refused before anything else   │
 │ IAM: JWT login, admin/analyst roles, login detection (9 rules)      │
 │ Alerts → rule engine → escalation ─┬─► notification job (BullMQ)    │
 │                                    └─► automatic IP block           │
 │ PAM: every privileged action → append-only audit trail (GET /audit) │
 └──────────────────────┬───────────────────────────┬──────────────────┘
                     PostgreSQL                   Redis
```

| Concern | What it means here | Where |
|---|---|---|
| **IAM** (identity and access management) | Who you are and what your role allows: JWT access/refresh tokens, `admin` vs `analyst`, API keys for apps, and login detection | [AUTH.md](./docs/AUTH.md), [LOGIN-DETECTION.md](./docs/LOGIN-DETECTION.md) |
| **PAM** (privileged access management) | Watching what privileged users do: every admin/analyst action, including refused attempts, is recorded and can't be edited | [AUDIT.md](./docs/AUDIT.md) |
| **Firewall / IP filter** | Blocking bad IPs, by hand or automatically when a rule fires. It protects this API and is offered to integrated apps as a service | [FIREWALL.md](./docs/FIREWALL.md) |
| **Detection and alerting** | Ingesting events, threshold rules, escalations and notifications | [ALERTS.md](./docs/ALERTS.md) |
| **Docker as a layer** | The whole service ships as containers that sit beside any app. The demo bank is the example integration | [Run with Docker](#run-with-docker-recommended) |

## Run with Docker (recommended)

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/). It runs the API, PostgreSQL, Redis and the demo bank together.

```bash
cp .env.example .env
# Open .env and set JWT_SECRET. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build      # or: npm run docker:up
```

Migrations run automatically when the API container starts. Check it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok","checks":{"database":"up","redis":"up"}}
```

If a port is already in use on your machine, change `API_HOST_PORT`, `BANK_HOST_PORT`, `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` in `.env`.

| Command | What it does |
|---|---|
| `npm run docker:up` | Build and start everything in the background |
| `npm run docker:logs` | Follow the API and bank logs |
| `npm run docker:down` | Stop everything (data is kept in Docker volumes) |
| `docker compose down -v` | Stop and **delete** the database and Redis data |
| `docker compose exec api node dist/scripts/seed-admin.js` | Create an admin inside the container |

## Demo

Set up the demo accounts, the detection rule and the bank's API key:

```bash
npm run demo:setup
```

This creates:
- `admin@lotus.demo` / `demo-admin-password`
- `analyst@lotus.demo` / `demo-analyst-password`
- the rule "5 failed logins in 60s → high"
- a source for the bank, whose API key is saved to `.env` (the bank container is then restarted)

Then walk through it:

1. **Normal login.** Open http://localhost:4000 and sign in as `dara` / `lotus-demo-123`. Nothing happens.
2. **Attack.** Sign in as `dara` with a wrong password 5 times, keeping the demo "visitor IP" at `203.0.113.10`. Each failure is sent to the API as an alert.
3. **Detection and response.** On the 5th failure the rule escalates a **high** alert and the firewall blocks `203.0.113.10` for 60 minutes. A notification job is queued for each configured channel. With none configured, the API logs that the alert wasn't sent anywhere. `npm run docker:logs` shows all of this.
4. **Blocked.** Sign in again from `203.0.113.10`, even with the right password: *"Access … has been blocked by our security service"*. Change the visitor IP and it works again.
5. **Respond.** As the analyst, list open high alerts and acknowledge one:
   ```bash
   TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"analyst@lotus.demo","password":"demo-analyst-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
   curl -s "localhost:3000/alerts?severity=high&status=open" -H "Authorization: Bearer $TOKEN"
   curl -s -X PATCH localhost:3000/alerts/<id>/status -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"status":"acknowledged"}'
   ```
6. **Privilege check.** The analyst tries `GET /audit` and gets `403`. That attempt is recorded too.
7. **Review.** As the admin, open `GET /audit`. It shows the rule and source creation, the system's automatic block, the acknowledgement and the refused attempt. Then `GET /firewall/blocked-ips` shows the block, and `DELETE /firewall/blocked-ips/:id` lifts it.
8. **Tests.** Run `npm test` and show the unit tests for the rules passing.

To send real notifications, set `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` or the `SMTP_*` settings in `.env`. Without them the API logs that nothing was sent.

## Run without Docker

You need Node.js 22+, PostgreSQL 14+ and Redis 6+. Alternatively, run only the databases in Docker with `docker compose up -d postgres redis`.

```bash
npm install
cp .env.example .env          # set JWT_SECRET and DATABASE_PASSWORD
createdb -U postgres security_alerts   # skip if Postgres runs in Docker
npm run migration:run
npm run seed:admin            # first admin (public sign-up only creates analysts)
npm run start:dev             # http://localhost:3000, restarts on save
```

Run migrations again whenever you pull new changes.

## Routes

`JWT` means `Authorization: Bearer <accessToken>`. `API key` means the `x-api-key` header of a registered source.

| Method | Route | Auth | Role | Purpose |
|---|---|---|---|---|
| POST | `/auth/register` | Public | | Create an analyst account |
| POST | `/auth/login` | Public | | Get tokens; runs login detection |
| POST | `/auth/refresh`, `/auth/logout` | Refresh token | | Rotate or end a session |
| GET | `/auth/me` | JWT | any | Current user |
| POST / GET | `/sources` | JWT | admin | Register an app (API key shown once) / list |
| POST / GET / PATCH | `/rules`, `/rules/:id` | JWT | admin | Detection rules |
| POST | `/alerts` | API key | | Ingest an event |
| GET | `/alerts`, `/alerts/:id` | JWT | admin, analyst | Filter, paginate, detail |
| PATCH | `/alerts/:id/status` | JWT | admin, analyst | Acknowledge or resolve (audited) |
| DELETE | `/alerts/:id` | JWT | admin | Delete (audited) |
| GET | `/devices` | JWT | any | My devices |
| PATCH / DELETE | `/devices/:id/trust`, `/devices/:id` | JWT | any | Trust or forget a device (audited) |
| GET | `/audit` | JWT | admin | Audit trail, filtered and paginated |
| POST | `/firewall/check` | API key | | Is this IP blocked? (for integrated apps) |
| POST / GET | `/firewall/blocked-ips` | JWT | admin | Block an IP or range / list active blocks |
| DELETE | `/firewall/blocked-ips/:id` | JWT | admin | Lift a block |
| GET | `/health` | Public | | Postgres and Redis status |

## Tests

```bash
npm test                 # unit tests, no database needed
npm run test:cov         # with coverage

# e2e: real Postgres + Redis, against a separate *_test database.
# With Docker, security_alerts_test is created for you on first start.
DATABASE_NAME=security_alerts_test npm run migration:run
DATABASE_NAME=security_alerts_test npm run test:e2e
```

The e2e suites refuse to run against a database whose name doesn't end in `_test`, because they empty tables. Stop any dev server first, including the Docker API (`docker compose stop api bank-demo`), since it would compete for the same Redis queue.

| Suite | Covers |
|---|---|
| `test/auth-login.e2e-spec.ts` | Register, login, recorded attempts and devices, refresh rotation, logout |
| `test/alerts.e2e-spec.ts` | Sources, ingest, filters, pagination, status changes |
| `test/rules-notifications.e2e-spec.ts` | Rules → escalation → BullMQ worker → notification, with retries |
| `test/audit-firewall.e2e-spec.ts` | Audit trail (including denied attempts and append-only), firewall, auto-block, health |

GitHub Actions ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs lint, build, unit and e2e tests and both Docker builds on every push and pull request.

## Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start in watch mode |
| `npm run build` then `npm run start:prod` | Build and run compiled code |
| `npm test` / `npm run test:e2e` | Unit / end-to-end tests |
| `npm run lint` / `npm run format` | Check / format code |
| `npm run migration:run` / `migration:revert` / `migration:show` | Manage the schema |
| `npm run migration:generate -- src/migrations/<Name>` | Create a migration from entity changes |
| `npm run seed:admin` | Create or promote an admin |
| `npm run docker:up` / `docker:down` / `docker:logs` | Docker stack |
| `npm run demo:setup` | Prepare the demo (Docker stack must be running) |

## Configuration

All settings are in [`.env.example`](./.env.example), with a comment on each. The app refuses to start with missing or unsafe values, such as a short `JWT_SECRET`, and says which setting is wrong.

## Team

| Area | Folders |
|---|---|
| 1. Auth & Security lead | `auth/`, `users/`, `common/` |
| 2. Alerts & Ingest | `sources/`, `alerts/` |
| 3. Rules & Notifications | `rules/`, `notifications/` |
| 4. Login Detection | `devices/`, login entities, `login-detector.service.ts` |
| 5. Audit, Tests & DevOps | `audit/`, `firewall/`, `health/`, `test/`, Docker, CI, `demo/` |

## License

UNLICENSED, private project.
