# API reference

Every HTTP endpoint the Security Alerts API exposes, with its auth, request, response and errors. For background on each area, see the guides next to this file: [AUTH.md](./AUTH.md), [LOGIN-DETECTION.md](./LOGIN-DETECTION.md), [ALERTS.md](./ALERTS.md), [AUDIT.md](./AUDIT.md), [FIREWALL.md](./FIREWALL.md).

- **Base URL:** `http://localhost:3000` (the `PORT` env var, default `3000`). There is no global prefix or version segment.
- **Format:** JSON in, JSON out. Send `Content-Type: application/json` on every request with a body.
- **IDs:** UUID v4. A malformed `:id` in the path returns `400`.
- **Timestamps:** ISO 8601 strings in UTC, e.g. `2026-11-17T08:30:00.000Z`.

## Contents

- [Authentication](#authentication)
- [Conventions](#conventions)
- [Endpoint summary](#endpoint-summary)
- [General](#general): `/`, `/health`
- [Auth](#auth): `/auth/*`
- [Devices](#devices): `/devices/*`
- [Sources](#sources): `/sources`
- [Alerts](#alerts): `/alerts/*`
- [Rules](#rules): `/rules/*`
- [Audit](#audit): `/audit`
- [Firewall](#firewall): `/firewall/*`
- [Data models](#data-models)

---

## Authentication

The API accepts two kinds of credential.

### 1. JWT bearer token (people)

Used by admins and analysts. Get one from `POST /auth/login`, then send it on every request:

```
Authorization: Bearer <accessToken>
```

- The access token lives for `JWT_ACCESS_EXPIRES_IN_SECONDS` (default 900 s = 15 min). The response's `expiresIn` field gives the exact value.
- When it expires, call `POST /auth/refresh` with the refresh token to get a new pair. Refresh tokens last `REFRESH_TOKEN_TTL_DAYS` (default 7 days) and can be used **once**. Reusing an old refresh token is treated as theft and ends all of that user's sessions.
- The token carries the user's `role`: `admin` or `analyst`. There is no public sign-up: admins create accounts with `POST /users`. Create the first admin with `npm run seed:admin`.

### 2. API key (integrated systems)

Used by external systems (servers, apps) that send alerts or check IPs. An admin creates a **source** with `POST /sources` and gets a key that starts with `sa_`. Send it as:

```
x-api-key: sa_...
```

The key is shown once, at creation. Only a bcrypt hash is stored. Only two endpoints accept an API key: `POST /alerts` and `POST /firewall/check`.

### Auth column legend

In the tables below:

| Value | Meaning |
|---|---|
| Public | No credential needed |
| JWT | Any logged-in user |
| JWT · admin | Logged-in user with the `admin` role |
| JWT · admin, analyst | Either role |
| API key | `x-api-key` header from an active source |

---

## Conventions

### Errors

Errors use NestJS's standard shape:

```json
{
  "statusCode": 404,
  "message": "Alert 3f2a… not found",
  "error": "Not Found"
}
```

For validation errors, `message` is an array with one entry per problem:

```json
{
  "statusCode": 400,
  "message": ["severity must be one of the following values: low, medium, high, critical"],
  "error": "Bad Request"
}
```

### Status codes

| Code | When |
|---|---|
| `200` | Success with a body |
| `201` | Created (all `POST` routes except `/auth/login`, `/auth/refresh` and `/firewall/check`, which return `200`) |
| `204` | Success, no body (`DELETE` routes and `/auth/logout`) |
| `400` | Validation failed: bad field, bad UUID, **or an unknown field** (bodies and query strings are strict) |
| `401` | Bad credentials, an invalid/expired bearer token, or a missing/invalid API key |
| `403` | Logged in but the role is not allowed, **or** the caller's IP is blocked by the firewall (`"Access denied"`) |
| `404` | Record not found, **or** a protected route was called with no bearer token (see below) |
| `409` | Conflict: duplicate email/name/IP, or an invalid alert status change |
| `429` | Rate limit hit on `/auth/*`, or login locked out by login detection |
| `503` | `/health` only: Postgres or Redis is down |

### Behaviour worth knowing

- **No token means 404, not 401.** A protected route called without an `Authorization: Bearer …` header answers exactly like a route that does not exist (`Cannot GET /alerts`). This stops anonymous scanners from mapping the API. A token that is present but invalid or expired gets `401`, so real clients know to refresh.
- **Strict input.** Unknown fields in a body or query string are rejected with `400`, not ignored. Strings that are trimmed (`title`, `type`, `name`) are trimmed before validation.
- **Firewall first.** A blocked IP gets `403 Access denied` on every route, before any auth runs.
- **Audit trail.** Every state-changing admin/analyst call, and every `403` a logged-in user gets, is recorded. See [`GET /audit`](#get-audit).

### Pagination

`GET /alerts` and `GET /audit` take `page` (default `1`) and `limit` (default `20`, max `100`) and return:

```json
{
  "data": [ ... ],
  "total": 137,
  "page": 1,
  "limit": 20
}
```

Results are newest first.

### Rate limits

Only the `/auth` routes are rate-limited, per client IP and per route. Going over returns `429` with a `Retry-After` header.

| Route | Limit |
|---|---|
| `POST /auth/login` | 5 per minute |
| `POST /auth/refresh` | 10 per minute |
| `POST /auth/logout` | 10 per minute |

Separately, login detection can lock an email or IP after repeated failures (`429 "Too many login attempts. Please try again later."`). See [LOGIN-DETECTION.md](./LOGIN-DETECTION.md).

### Optional request headers

| Header | Used by | Purpose |
|---|---|---|
| `X-Device-Id` | `POST /auth/login` | A stable ID for the client device (8–128 chars of `A-Z a-z 0-9 _ -`). Makes device recognition more accurate. |
| `User-Agent` | `POST /auth/login` | Used to name and fingerprint the device. |
| `X-Forwarded-For`, `CF-IPCountry`, `CloudFront-Viewer-Country`, `X-Country-Code` | all | Only honoured when the server runs with `TRUST_PROXY` set. |

---

## Endpoint summary

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | [`/`](#get-) | Public | Hello world |
| GET | [`/health`](#get-health) | Public | Postgres and Redis status |
| POST | [`/users`](#post-users) | JWT admin | Create a staff account |
| GET | `/users` | JWT admin | List staff accounts |
| PATCH | `/users/:id/role` | JWT admin | Change a role (not your own) |
| POST | [`/auth/login`](#post-authlogin) | Public | Log in |
| POST | [`/auth/refresh`](#post-authrefresh) | Public (refresh token) | Swap a refresh token for a new pair |
| POST | [`/auth/logout`](#post-authlogout) | Public (refresh token) | End the session |
| GET | [`/auth/me`](#get-authme) | JWT | Current user |
| GET | [`/devices`](#get-devices) | JWT | My devices |
| PATCH | [`/devices/:id/trust`](#patch-devicesidtrust) | JWT | Mark one of my devices trusted |
| DELETE | [`/devices/:id`](#delete-devicesid) | JWT | Forget one of my devices |
| POST | [`/sources`](#post-sources) | JWT · admin | Create a source and its API key |
| GET | [`/sources`](#get-sources) | JWT · admin | List sources |
| POST | [`/alerts`](#post-alerts) | API key | Send an alert |
| GET | [`/alerts`](#get-alerts) | JWT · admin, analyst | List and filter alerts |
| GET | [`/alerts/:id`](#get-alertsid) | JWT · admin, analyst | One alert |
| PATCH | [`/alerts/:id/status`](#patch-alertsidstatus) | JWT · admin, analyst | Acknowledge or resolve |
| DELETE | [`/alerts/:id`](#delete-alertsid) | JWT · admin | Delete an alert |
| POST | [`/rules`](#post-rules) | JWT · admin | Create a threshold rule |
| GET | [`/rules`](#get-rules) | JWT · admin | List rules |
| GET | [`/rules/:id`](#get-rulesid) | JWT · admin | One rule |
| PATCH | [`/rules/:id`](#patch-rulesid) | JWT · admin | Update a rule |
| GET | [`/audit`](#get-audit) | JWT · admin | Search the audit trail |
| POST | [`/firewall/check`](#post-firewallcheck) | API key | Is this IP blocked? |
| POST | [`/firewall/blocked-ips`](#post-firewallblocked-ips) | JWT · admin | Block an IP or range |
| GET | [`/firewall/blocked-ips`](#get-firewallblocked-ips) | JWT · admin | List active blocks |
| DELETE | [`/firewall/blocked-ips/:id`](#delete-firewallblocked-ipsid) | JWT · admin | Remove a block |

---

## General

### `GET /`

**Auth:** Public

Returns the plain-text string `Hello World!`. Useful as a smoke test.

### `GET /health`

**Auth:** Public

Checks that Postgres and Redis both answer within 2 seconds. Meant for Docker health checks and load balancers.

**200 OK**

```json
{ "status": "ok", "checks": { "database": "up", "redis": "up" } }
```

**503 Service Unavailable** (same shape)

```json
{ "status": "error", "checks": { "database": "up", "redis": "down" } }
```

---

## Auth

All `/auth` routes are rate-limited (see [Rate limits](#rate-limits)).

### Auth response

`login` and `refresh` both return this:

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "expiresIn": 900,
  "refreshToken": "q8Zk…",
  "user": {
    "id": "6b1c0f4e-…",
    "email": "analyst@example.com",
    "role": "analyst",
    "timezone": "Asia/Phnom_Penh",
    "createdAt": "2026-11-17T08:30:00.000Z"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `tokenType` | `"Bearer"` | |
| `accessToken` | string | JWT. Send as `Authorization: Bearer …` |
| `expiresIn` | number | Access token lifetime in seconds |
| `refreshToken` | string | Opaque, single-use. Store it securely |
| `user` | object | `id`, `email`, `role`, `timezone` (nullable), `createdAt` |

### `POST /users`

**Auth:** JWT, admin

Creates a staff account. There is no public sign-up. Audited as `created_user`.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | Valid email, max 255 |
| `password` | string | yes | 12–128 characters |
| `role` | string | no | `analyst` (default) or `admin` |
| `timezone` | string | no | IANA time zone, e.g. `Asia/Phnom_Penh` |

```bash
curl -X POST http://localhost:3000/users \
  -H "Authorization: Bearer <adminToken>" -H "Content-Type: application/json" \
  -d '{"email":"analyst@example.com","password":"a-long-passphrase","role":"analyst"}'
```

**201 Created:** `{ id, email, role, timezone, createdAt }` (never the password hash)

**Errors:** `400` validation · `403` not an admin · `409` `Email already registered`

`PATCH /users/:id/role` with `{ "role": "admin" }` changes a role: `400` for your own account, `404` for an unknown id. Audited as `changed_user_role`.

### `POST /auth/login`

**Auth:** Public · **Rate limit:** 5/min

Each attempt is recorded and checked by the login detection rules (brute force, new device, impossible travel and so on). Depending on the risk, the login may succeed, succeed and raise an alert, or be refused.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | Valid email, max 255 |
| `password` | string | yes | 1–128 characters |

Optional headers: `X-Device-Id`, `User-Agent` (see [Optional request headers](#optional-request-headers)).

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: laptop-7f3a9c21" \
  -d '{"email":"analyst@example.com","password":"a-long-passphrase"}'
```

**200 OK:** [Auth response](#auth-response)

**Errors:**

- `400` validation
- `401` `Invalid credentials`: wrong email or password. The same message and timing for both, so it does not reveal whether an account exists. Also returned when login detection refuses a high-risk login.
- `429` rate limit, or `Too many login attempts. Please try again later.` while the email or IP is locked out

### `POST /auth/refresh`

**Auth:** Public (the refresh token is the credential) · **Rate limit:** 10/min

Swaps a refresh token for a new access token **and** a new refresh token. The old refresh token stops working.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `refreshToken` | string | yes | 1–128 characters |

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"q8Zk…"}'
```

**200 OK:** [Auth response](#auth-response)

**Errors:** `400` validation · `401` `Invalid refresh token` (unknown, expired, revoked or already used) · `429` rate limit

> Presenting a refresh token that was already used revokes **every** session of that user. Their other devices will have to log in again.

### `POST /auth/logout`

**Auth:** Public (the refresh token is the credential) · **Rate limit:** 10/min

Ends the session the refresh token belongs to. Works even after the access token has expired. The access token itself stays valid until it expires (at most `expiresIn` seconds), so clients should throw it away.

**Body:** `{ "refreshToken": "q8Zk…" }`

**204 No Content**

**Errors:** `400` validation · `429` rate limit

### `GET /auth/me`

**Auth:** JWT

Returns the user the access token belongs to.

**200 OK**

```json
{ "id": "6b1c0f4e-…", "email": "analyst@example.com", "role": "analyst" }
```

---

## Devices

Each user manages only their own devices. A device is saved the first time a user logs in from it, as untrusted. Asking for another user's device returns `404`, not `403`, so device IDs cannot be probed.

### `GET /devices`

**Auth:** JWT

Lists the caller's devices, most recently used first.

**200 OK:** array of [Device](#device)

```json
[
  {
    "id": "c0a8…",
    "userId": "6b1c0f4e-…",
    "fingerprint": "9f86d081884c7d65…",
    "name": "Chrome on Windows",
    "ipAddress": "203.0.113.7",
    "location": "KH",
    "firstSeenAt": "2026-11-01T02:10:00.000Z",
    "lastSeenAt": "2026-11-17T08:30:00.000Z",
    "isTrusted": false
  }
]
```

### `PATCH /devices/:id/trust`

**Auth:** JWT

Marks one of the caller's devices as trusted. No body.

**200 OK:** the updated [Device](#device), with `isTrusted: true`

**Errors:** `400` bad UUID · `404` `Device not found`

### `DELETE /devices/:id`

**Auth:** JWT

Forgets one of the caller's devices. The next login from it counts as a new device again.

**204 No Content**

**Errors:** `400` bad UUID · `404` `Device not found`

---

## Sources

A source is an external system allowed to send alerts. Creating one issues its API key.

### `POST /sources`

**Auth:** JWT · admin

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | Trimmed, not empty, max 120, unique |

```bash
curl -X POST http://localhost:3000/sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"web-server-1"}'
```

**201 Created**

```json
{
  "id": "27f5c1e2-…",
  "name": "web-server-1",
  "apiKeyPrefix": "sa_4PYcAqeK",
  "isActive": true,
  "createdAt": "2026-11-17T08:30:00.000Z",
  "apiKey": "sa_4PYcAqeK…"
}
```

> `apiKey` appears **only in this response**. Save it now. It cannot be retrieved later.

**Errors:** `400` validation · `403` not an admin · `409` `A source with this name already exists`

### `GET /sources`

**Auth:** JWT · admin

Lists all sources, newest first. Keys are never included.

**200 OK:** array of [Source](#source)

---

## Alerts

### `POST /alerts`

**Auth:** API key (`x-api-key`)

Called by an external system to report a security event. The alert is saved with status `open` and attached to the source that owns the key. This also runs the threshold rules for the alert's `type`, which may raise an escalated alert, send notifications and auto-block the IP.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `title` | string | yes | Trimmed, not empty, max 200 |
| `severity` | string | yes | `low`, `medium`, `high` or `critical` |
| `type` | string | yes | snake_case, max 64, e.g. `failed_login`, `port_scan` |
| `ipAddress` | string | no | Valid IPv4 or IPv6 |
| `payload` | object | no | Any JSON object. Defaults to `{}` |

Do not send `sourceId`, `status` or `id`: they are set by the server, and sending them returns `400`.

```bash
curl -X POST http://localhost:3000/alerts \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Failed login","severity":"high","type":"failed_login","ipAddress":"203.0.113.7","payload":{"username":"bob"}}'
```

**201 Created:** the new [Alert](#alert)

```json
{
  "id": "3f2a9b1c-…",
  "title": "Failed login",
  "severity": "high",
  "type": "failed_login",
  "ipAddress": "203.0.113.7",
  "payload": { "username": "bob" },
  "status": "open",
  "sourceId": "27f5c1e2-…",
  "createdAt": "2026-11-17T08:30:00.000Z"
}
```

**Errors:** `400` validation · `401` `Missing API key` / `Invalid API key` (also for an inactive source)

### `GET /alerts`

**Auth:** JWT · admin, analyst

Lists alerts, newest first, with optional filters. All filters combine with AND.

**Query parameters**

| Param | Type | Rules |
|---|---|---|
| `severity` | string | `low`, `medium`, `high`, `critical` |
| `status` | string | `open`, `acknowledged`, `resolved` |
| `type` | string | snake_case, max 64 |
| `sourceId` | UUID | |
| `ipAddress` | string | Valid IP, exact match |
| `from` | ISO 8601 | Created at or after |
| `to` | ISO 8601 | Created at or before. Must not be earlier than `from` |
| `page` | integer | ≥ 1, default 1 |
| `limit` | integer | 1–100, default 20 |

```bash
curl "http://localhost:3000/alerts?severity=high&status=open&from=2026-11-01T00:00:00Z&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**200 OK:** [paginated](#pagination) list of [Alert](#alert)

**Errors:** `400` validation, or `from must be before to` · `403` role not allowed

### `GET /alerts/:id`

**Auth:** JWT · admin, analyst

**200 OK:** one [Alert](#alert)

**Errors:** `400` bad UUID · `404` `Alert <id> not found`

### `PATCH /alerts/:id/status`

**Auth:** JWT · admin, analyst

Moves an alert forward in its lifecycle. Status only goes forward:

```
open ──► acknowledged ──► resolved
  └───────────────────────►┘
```

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | yes | `acknowledged` or `resolved` (you cannot set `open`) |

```bash
curl -X PATCH http://localhost:3000/alerts/3f2a9b1c-…/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"acknowledged"}'
```

**200 OK:** the updated [Alert](#alert)

**Errors:**

- `400` validation
- `404` `Alert <id> not found`
- `409` `Cannot change status from resolved to acknowledged`: the move is not allowed
- `409` `Alert status changed meanwhile, reload and retry`: someone else changed it at the same moment

### `DELETE /alerts/:id`

**Auth:** JWT · admin

Permanently deletes an alert and its notifications.

**204 No Content**

**Errors:** `400` bad UUID · `403` not an admin · `404` `Alert <id> not found`

---

## Rules

A threshold rule says: "if **`threshold`** alerts of **`type`** arrive within **`windowSeconds`**, raise an escalated alert with **`severity`**." Escalated `high` and `critical` alerts send notifications and can auto-block the offending IP. See [ALERTS.md](./ALERTS.md).

There is no delete route. Turn a rule off with `isEnabled: false`.

### `POST /rules`

**Auth:** JWT · admin

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | Trimmed, not empty, max 100 |
| `type` | string | yes | snake_case, max 64. The alert type to count |
| `threshold` | integer | yes | ≥ 1 |
| `windowSeconds` | integer | yes | 1–86400 (24 h) |
| `severity` | string | yes | `low`, `medium`, `high`, `critical` |
| `isEnabled` | boolean | no | Default `true` |

```bash
curl -X POST http://localhost:3000/rules \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Brute force","type":"failed_login","threshold":5,"windowSeconds":60,"severity":"critical"}'
```

**201 Created:** the new [Rule](#rule)

```json
{
  "id": "a41e…",
  "name": "Brute force",
  "type": "failed_login",
  "threshold": 5,
  "windowSeconds": 60,
  "severity": "critical",
  "isEnabled": true,
  "createdAt": "2026-11-17T08:30:00.000Z"
}
```

**Errors:** `400` validation · `403` not an admin

### `GET /rules`

**Auth:** JWT · admin

**200 OK:** array of [Rule](#rule), newest first

### `GET /rules/:id`

**Auth:** JWT · admin

**200 OK:** one [Rule](#rule)

**Errors:** `400` bad UUID · `404` `Alert rule with ID <id> not found`

### `PATCH /rules/:id`

**Auth:** JWT · admin

Partial update. Send only the fields to change. Same rules as `POST /rules`, all optional.

```bash
curl -X PATCH http://localhost:3000/rules/a41e… \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"isEnabled":false}'
```

**200 OK:** the updated [Rule](#rule)

**Errors:** `400` validation · `404` `Alert rule with ID <id> not found`

---

## Audit

### `GET /audit`

**Auth:** JWT · admin

Searches the audit trail, newest first. The trail is read-only: there are no routes to edit or delete entries, and the database rejects updates and deletes.

**What gets recorded**

- Every state-changing admin/analyst call, whatever the result (success, denied or failed).
- Any `403` a logged-in user gets, as `access_denied` (e.g. an analyst calling `GET /audit`).
- Automatic IP blocks, with `actorRole: "system"`.
- Anonymous requests are never recorded.

**Query parameters**

| Param | Type | Rules |
|---|---|---|
| `userId` | UUID | Who did it |
| `action` | string | Max 64. See the list below |
| `outcome` | string | `success`, `denied`, `failed` |
| `targetType` | string | Max 32: `alert`, `rule`, `source`, `device`, `blocked_ip` |
| `targetId` | string | Max 64 |
| `from` | ISO 8601 | At or after |
| `to` | ISO 8601 | At or before |
| `page` | integer | ≥ 1, default 1 |
| `limit` | integer | 1–100, default 20 |

**Actions**

| Action | Triggered by |
|---|---|
| `created_source` | `POST /sources` |
| `created_rule` | `POST /rules` |
| `updated_rule` | `PATCH /rules/:id` |
| `acknowledged_alert` | `PATCH /alerts/:id/status` with `acknowledged` |
| `resolved_alert` | `PATCH /alerts/:id/status` with `resolved` |
| `changed_alert_status` | `PATCH /alerts/:id/status` with any other value |
| `deleted_alert` | `DELETE /alerts/:id` |
| `trusted_device` | `PATCH /devices/:id/trust` |
| `revoked_device` | `DELETE /devices/:id` |
| `blocked_ip` | `POST /firewall/blocked-ips`, or an automatic block |
| `unblocked_ip` | `DELETE /firewall/blocked-ips/:id` |
| `access_denied` | Any `403` for a logged-in user |

```bash
curl "http://localhost:3000/audit?outcome=denied&limit=50" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**200 OK:** [paginated](#pagination) list of [Audit log](#audit-log)

```json
{
  "data": [
    {
      "id": "e7d2…",
      "userId": "6b1c0f4e-…",
      "actorEmail": "analyst@example.com",
      "actorRole": "analyst",
      "action": "access_denied",
      "outcome": "denied",
      "targetType": null,
      "targetId": null,
      "method": "GET",
      "path": "/audit",
      "statusCode": 403,
      "ip": "203.0.113.7",
      "metadata": {},
      "createdAt": "2026-11-17T08:30:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

**Errors:** `400` validation, or `from must be before to` · `403` not an admin

---

## Firewall

Blocked IPs are refused with `403 Access denied` on **every** route of this API. Integrated apps can also ask whether an IP is blocked before letting their own users in. See [FIREWALL.md](./FIREWALL.md).

Addresses listed in `FIREWALL_ALLOWLIST` are never blocked.

### `POST /firewall/check`

**Auth:** API key (`x-api-key`)

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ip` | string | yes | Valid IPv4 or IPv6 |

```bash
curl -X POST http://localhost:3000/firewall/check \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"ip":"203.0.113.7"}'
```

**200 OK**

```json
{
  "ip": "203.0.113.7",
  "blocked": true,
  "reason": "Brute force on failed_login",
  "expiresAt": "2026-11-17T09:30:00.000Z"
}
```

When not blocked: `"blocked": false`, `"reason": null`, `"expiresAt": null`. A `null` `expiresAt` on a blocked IP means the block is permanent.

**Errors:** `400` validation · `401` `Missing API key` / `Invalid API key`

### `POST /firewall/blocked-ips`

**Auth:** JWT · admin

Blocks one IP or a CIDR range. Takes effect at once on this instance, and within 15 seconds on other instances.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ip` | string | yes | A single IP (`203.0.113.7`) or a CIDR range (`203.0.113.0/24`), 2–49 chars |
| `reason` | string | no | Max 200. Default `Blocked by an admin` |
| `expiresInMinutes` | integer | no | 1–525600 (one year). Leave out for a permanent block |

```bash
curl -X POST http://localhost:3000/firewall/blocked-ips \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"ip":"198.51.100.0/24","reason":"Scanner range","expiresInMinutes":1440}'
```

**201 Created:** the new [Blocked IP](#blocked-ip)

```json
{
  "id": "b9c4…",
  "network": "198.51.100.0/24",
  "reason": "Scanner range",
  "origin": "manual",
  "createdBy": "1d2e…",
  "alertId": null,
  "expiresAt": "2026-11-18T08:30:00.000Z",
  "createdAt": "2026-11-17T08:30:00.000Z"
}
```

**Errors:**

- `400` invalid IP or range, a range that is too wide, a range that overlaps `FIREWALL_ALLOWLIST`, or a range that includes **your own** IP (so you cannot lock yourself out)
- `403` not an admin
- `409` `<network> is already blocked`

### `GET /firewall/blocked-ips`

**Auth:** JWT · admin

Lists the blocks that are still active (permanent, or not yet expired), newest first. Expired rows are kept as history but not shown.

**200 OK:** array of [Blocked IP](#blocked-ip)

### `DELETE /firewall/blocked-ips/:id`

**Auth:** JWT · admin

Removes a block. Takes effect at once on this instance.

**204 No Content**

**Errors:** `400` bad UUID · `403` not an admin · `404` `Blocked IP <id> not found`

---

## Data models

Fields as they appear in JSON responses. "nullable" means the value can be `null`.

### Enums

| Enum | Values |
|---|---|
| Role | `admin`, `analyst` |
| Alert severity | `low`, `medium`, `high`, `critical` |
| Alert status | `open`, `acknowledged`, `resolved` |
| Audit outcome | `success` (2xx/3xx), `denied` (401/403), `failed` (anything else) |
| Block origin | `manual` (an admin), `auto` (a rule escalated a high or critical alert) |

### User

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `email` | string | |
| `role` | Role | |
| `timezone` | string, nullable | IANA time zone |
| `createdAt` | timestamp | |

### Device

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `userId` | UUID | Owner |
| `fingerprint` | string | SHA-256 of browser, OS, device type and `X-Device-Id` |
| `name` | string | e.g. `Chrome on Windows` |
| `ipAddress` | string | Last IP used |
| `location` | string, nullable | Last country (ISO 3166-1 alpha-2), when known |
| `firstSeenAt` | timestamp | |
| `lastSeenAt` | timestamp | |
| `isTrusted` | boolean | `false` until the user trusts it |

### Source

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | Unique |
| `apiKeyPrefix` | string, nullable | First 11 characters of the key, e.g. `sa_4PYcAqeK`. Lets you tell keys apart |
| `isActive` | boolean | Inactive sources' keys are refused |
| `createdAt` | timestamp | |
| `apiKey` | string | **Only** in the `POST /sources` response |

### Alert

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | string | Max 200 |
| `severity` | Alert severity | |
| `type` | string | snake_case |
| `ipAddress` | string, nullable | |
| `payload` | object | Free-form JSON, `{}` by default |
| `status` | Alert status | Starts as `open` |
| `sourceId` | UUID | Source that sent it |
| `createdAt` | timestamp | |

### Rule

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | |
| `type` | string | Alert type it counts |
| `threshold` | integer | How many alerts |
| `windowSeconds` | integer | Within how many seconds |
| `severity` | Alert severity | Severity of the escalated alert |
| `isEnabled` | boolean | |
| `createdAt` | timestamp | |

### Audit log

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `userId` | UUID, nullable | `null` for system actions |
| `actorEmail` | string, nullable | Copied at the time, so it survives the user being deleted |
| `actorRole` | string | `admin`, `analyst` or `system` |
| `action` | string | See [Actions](#get-audit) |
| `outcome` | Audit outcome | |
| `targetType` | string, nullable | `alert`, `rule`, `source`, `device`, `blocked_ip` |
| `targetId` | string, nullable | |
| `method` | string, nullable | HTTP method |
| `path` | string, nullable | Request URL |
| `statusCode` | integer, nullable | Response status |
| `ip` | string, nullable | Caller IP |
| `metadata` | object | Short, non-secret details, e.g. `{ "status": "resolved" }` |
| `createdAt` | timestamp | |

### Blocked IP

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `network` | string | Normalised CIDR. A single IP is stored as `/32` (IPv4) or `/128` (IPv6) |
| `reason` | string | |
| `origin` | Block origin | |
| `createdBy` | UUID, nullable | Admin who added it. `null` for automatic blocks |
| `alertId` | UUID, nullable | The escalated alert behind an automatic block |
| `expiresAt` | timestamp, nullable | `null` means permanent |
| `createdAt` | timestamp | |
