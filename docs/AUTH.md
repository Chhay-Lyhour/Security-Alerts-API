# Authentication and Authorization

This covers how users and external systems authenticate, how roles are enforced, and the security choices behind it. It is the implementation of build step 1 in [SPECS.md](../SPECS.md).

There are two kinds of caller:

| Caller | Credential | Used for |
|---|---|---|
| A person (admin or analyst) | JWT access token, renewed with a refresh token | Everything except ingest |
| An external system (a Source) | API key in the `x-api-key` header | `POST /alerts` only |

## Quick start

1. Set the required config in `.env` (see [Configuration](#configuration)). At minimum, `JWT_SECRET`.
2. Create the tables: `npm run migration:run`
3. Start the app: `npm run start:dev`
4. Create the first admin: `npm run seed:admin` (see [Creating admins](#creating-admins)). Public registration only ever creates analysts.

```bash
# Log in
curl -X POST localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"a-strong-admin-password"}'

# Call a protected route with the access token
curl localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"
```

## Creating admins

Anyone can register, but always as an analyst. If the first registered user became admin automatically, an attacker who found a fresh deployment first could take it over. Admins are created from the command line instead, which needs access to the server and its database.

```
> npm run seed:admin
Admin email: admin@example.com
Password (12-128 characters): ************
Confirm password: ************
✔ Admin admin@example.com created.
```

- The password is typed at a hidden prompt, so it never ends up in a file or in shell history.
- It goes through the same rules as `/auth/register`.
- If the email already belongs to an analyst, the script offers to promote them. Their password is not changed.
- If the email is already an admin, nothing changes. The script never overwrites a password.
- Pass the email up front with `npm run seed:admin -- --email admin@example.com`.
- For automation, pipe the answers in, one per line: email, password, confirmation.

On Windows, run it from PowerShell or the VS Code terminal. In Git Bash (mintty), Node can't hide the typed characters.

## Endpoints

| Method | Route | Auth | Rate limit (per IP) | Purpose |
|---|---|---|---|---|
| POST | `/auth/register` | Public | 3 / min | Create an analyst account and get tokens |
| POST | `/auth/login` | Public | 5 / min | Get tokens |
| POST | `/auth/refresh` | Public (refresh token in body) | 10 / min | Swap a refresh token for a new pair |
| POST | `/auth/logout` | Public (refresh token in body) | 10 / min | End the session |
| GET | `/auth/me` | JWT | none | Show the logged-in user |

### `POST /auth/register`

```json
{ "email": "analyst@example.com", "password": "at-least-12-chars", "timezone": "Asia/Phnom_Penh" }
```

- `password`: 12–128 characters.
- `timezone`: optional IANA name, used later by the "unusual login time" rule.
- Any extra field, including `role`, is rejected with 400.

Responses: `201` with the [token response](#token-response), `409` if the email is already registered, `400` for invalid input.

### `POST /auth/login`

```json
{ "email": "analyst@example.com", "password": "at-least-12-chars" }
```

Responses: `200` with the [token response](#token-response), `401 Invalid credentials`. The message and response time are the same whether the email or the password is wrong, so the endpoint can't be used to find out which accounts exist.

### `POST /auth/refresh`

```json
{ "refreshToken": "rt_..." }
```

Responses: `200` with a new [token response](#token-response). The refresh token you sent stops working. `401 Invalid refresh token` if it is unknown, expired, revoked or already used.

### `POST /auth/logout`

```json
{ "refreshToken": "rt_..." }
```

Responses: `204`, always, including for unknown tokens. This ends the session the token belongs to. It does not need an access token, so logout still works after the access token has expired.

### Token response

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "refreshToken": "rt_Xb3...",
  "user": {
    "id": "6f1c...",
    "email": "analyst@example.com",
    "role": "analyst",
    "timezone": null,
    "createdAt": "2026-11-10T03:12:00.000Z"
  }
}
```

`expiresIn` is the access token lifetime in seconds.

## Tokens

| | Access token | Refresh token |
|---|---|---|
| Format | JWT, HS256, payload `{ sub, email, role }` | Random 256-bit value, prefixed `rt_` |
| Lifetime | 15 min (`JWT_ACCESS_EXPIRES_IN_SECONDS`) | 7 days (`REFRESH_TOKEN_TTL_DAYS`) |
| Sent as | `Authorization: Bearer <token>` | JSON body to `/auth/refresh` and `/auth/logout` |
| Stored server-side | No | SHA-256 hash only, in `refresh_tokens` |

### Client flow

1. Log in and keep both tokens.
2. Send the access token on every request.
3. When a request returns **401**, call `/auth/refresh` once, store the new pair, and retry.
4. If the refresh also returns 401, send the user to log in again.

Make only one refresh call at a time. See [rotation and reuse detection](#rotation-and-reuse-detection) for why.

### Rotation and reuse detection

Every login starts a session (a token "family"). Every refresh spends the current refresh token and issues a new one in the same family. A token can be spent once, and the database update that spends it is atomic, so two simultaneous requests can't both succeed.

If a token that was **already used** is presented again, someone else probably has a copy. The API then revokes **every session for that user** and logs a warning. The real user has to log in again, and so does the attacker, who can't.

The catch: a client that retries a refresh request in parallel, with the same token, triggers this and logs the user out everywhere.

### What revocation does not cover

Revoking a session (logout, or reuse detection) stops its refresh token immediately. Access tokens already issued keep working until they expire, for up to 15 minutes. The JWT strategy does reload the user on every request, so a **deleted user** or a **changed role** takes effect at once.

## Roles and route protection

Two guards run on every route, in this order:

1. **`JwtAuthGuard`**: requires a valid access token unless the route is `@Public()`.
2. **`RolesGuard`**: if the route has `@Roles(...)`, the user's role must be listed.

Routes without `@Roles` are open to any logged-in user.

### Protected routes look like they don't exist

To stop attackers mapping the API, some failures return the exact 404 Nest gives for a route that doesn't exist (`{"message":"Cannot GET /audit","error":"Not Found","statusCode":404}`), with identical headers:

| Situation | Response |
|---|---|
| No `Authorization: Bearer ...` header on a protected route | 404, same as an unknown route |
| Logged in, but the wrong role | 404, same as an unknown route |
| Bearer token present but invalid or expired | 401, so clients know to refresh |

The real reason is logged server-side as a warning.

### Decorators

```ts
import { Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import type { AuthUser } from '../common/types/auth-user.type.js';

@Controller('alerts')
export class AlertsController {
  @Get()                                    // any logged-in user
  list(@CurrentUser() user: AuthUser) {}

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)  // either role
  updateStatus(@Param('id') id: string, @CurrentUser('id') userId: string) {}

  @Delete(':id')
  @Roles(UserRole.ADMIN)                    // admin only; others get 404
  remove(@Param('id') id: string) {}
}
```

| Decorator | Effect |
|---|---|
| `@Public()` | Skips the JWT check. Put it on a route or a whole controller. |
| `@Roles(...roles)` | Only the listed roles may call the route. |
| `@CurrentUser()` | Injects `{ id, email, role }`. `@CurrentUser('id')` injects one field. |

## API keys for external systems

Sources send alerts with an API key instead of a JWT:

```ts
import { Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';

@Public()                // no JWT needed...
@UseGuards(ApiKeyGuard)  // ...an API key is required instead
@Post()
ingest(@Req() req: Request) {
  const source = req.source!; // the Source that sent this request
}
```

- The key goes in the `x-api-key` header. A missing, unknown or inactive key gets `401`.
- Keys are random 256-bit values prefixed `sa_`, from `SourcesService.generateApiKey()`. Only their SHA-256 hash is stored, so a key is shown once, when the source is created.
- Unlike JWT routes, a missing key returns 401 rather than 404. `POST /alerts` is the documented entry point for integrations, so hiding it gains nothing, and the 401 helps whoever is setting one up.

`POST /sources` (creating sources and issuing keys) is build step 2.

## Error responses

| Status | When |
|---|---|
| 400 | Invalid body, or fields that aren't allowed |
| 401 | Wrong login, bad or expired token, bad refresh token, bad API key |
| 404 | Unknown route, **or** a protected route with no token or the wrong role |
| 409 | Email already registered |
| 429 | Rate limit exceeded. Wait for the seconds in `Retry-After`. |

## Configuration

The app checks these at startup and **refuses to start** if they are missing or weak.

| Variable | Required | Default | Rule |
|---|---|---|---|
| `JWT_SECRET` | Yes | | At least 32 characters, not the example placeholder |
| `JWT_ACCESS_EXPIRES_IN_SECONDS` | No | `900` | Positive whole number |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | Positive whole number |
| `TRUST_PROXY` | No | | Number of proxies in front of the API |
| `CORS_ORIGINS` | No | | Comma-separated browser origins |

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are no longer used. If either is still set, the app refuses to start and tells you to remove it, so no password sits in `.env` doing nothing.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**`TRUST_PROXY`**: behind nginx or a load balancer, every request appears to come from the proxy's IP. All users would then share one rate limit, and logs would lose real IPs. Set it to the exact number of proxies, usually `1`. Setting it higher than the real number lets clients fake their IP.

**`CORS_ORIGINS`**: leave it empty for a backend-only API. Browsers then can't call it from other sites. Server-to-server calls are unaffected.

## Security measures

| Area | Measure |
|---|---|
| Passwords | Argon2id (19 MiB memory, 2 iterations, 1 thread). 12–128 characters. |
| Account enumeration | Same error and similar timing for unknown email and wrong password |
| Privilege escalation | Registration can't set a role. Admins come only from `npm run seed:admin`. |
| Token theft | Short access tokens. Single-use refresh tokens with reuse detection. Only hashes stored. |
| Token forgery | Algorithm pinned to HS256. Startup rejects weak secrets. |
| Route discovery | Protected routes return the same 404 as unknown routes |
| Brute force | Per-IP rate limits on every auth route |
| HTTP hardening | `helmet` security headers. CORS off by default. `X-Powered-By` removed. |
| Input | Global validation. Unknown fields rejected. |
| Logging | Every request logged with status, duration, caller and IP. Denied access, missing tokens and refresh reuse logged as warnings. |

## Known limitations

| Limitation | Plan |
|---|---|
| Rate limits are per IP only. An attacker using many IPs can keep guessing one account. | Per-account lockout with login detection, step 6 (rule 1) |
| Login attempts aren't recorded | Step 6 |
| No password reset, password change or MFA | Needs email, which arrives in step 4 |
| Expired refresh tokens stay in the database | Cleanup job with BullMQ, step 4 |
| Rate-limit counters live in memory: they reset on restart and aren't shared between instances | Move to Redis before running more than one instance |
| Access tokens can't be revoked before they expire | Accepted trade-off. 15-minute lifetime keeps the window short. |

## Where the code lives

```
src/
├── auth/
│   ├── auth.controller.ts          endpoints and rate limits
│   ├── auth.service.ts             register, login, refresh, logout
│   ├── refresh-tokens.service.ts   issue, rotate, revoke, reuse detection
│   ├── jwt.strategy.ts             verifies JWTs, reloads the user
│   ├── entities/refresh-token.entity.ts
│   └── dto/                        register, login, refresh-token
├── users/
│   ├── users.service.ts            user lookup, creation, role changes
│   ├── password.util.ts            Argon2id hash and verify
│   └── entities/                   user, user-role
├── sources/sources.service.ts      API key generation and lookup
├── common/
│   ├── guards/                     jwt-auth, roles, api-key
│   ├── decorators/                 public, roles, current-user
│   ├── interceptors/logging.interceptor.ts
│   ├── http/route-not-found.ts     the shared "unknown route" 404
│   └── crypto.util.ts              SHA-256 and random tokens
├── config/
│   ├── env.validation.ts           startup config checks
│   └── typeorm.config.ts           database connection, shared with scripts
├── scripts/seed-admin.ts           npm run seed:admin
├── main.ts                         helmet, CORS, trust proxy, validation
└── migrations/                     users + sources, refresh_tokens
```
