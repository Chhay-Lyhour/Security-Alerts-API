# Login Detection

This covers how every login attempt is recorded and checked for attacks, how users' devices are tracked, and how the API responds when something looks wrong. It is the implementation of build step 6 in [SPECS.md](../SPECS.md) (sections 4, 6 and 7), and it builds on [AUTH.md](./AUTH.md).

Every call to `POST /auth/login` is treated as a security signal, not just a credential check:

| Stage | What happens |
|---|---|
| **Detect** | The attempt is saved, then 9 rules check it against recent history |
| **Score** | The rules that fired are combined into one risk level: none, low, medium, high or critical |
| **Protect** | The API allows the login, locks the email or IP, or refuses to issue a token |

## Quick start

1. Create the tables: `npm run migration:run` (adds `devices`, `login_attempts` and `lockouts`)
2. Start the app: `npm run start:dev`
3. Log in as usual. Every attempt now appears in `login_attempts`.

```bash
# Log in (detection runs automatically)
curl -X POST localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: my-laptop-install-1234" \
  -d '{"email":"analyst@example.com","password":"at-least-12-chars"}'

# See your devices
curl localhost:3000/devices -H "Authorization: Bearer <accessToken>"
```

To see what detection found, query the database:

```sql
SELECT "createdAt", email, ip, success, blocked, "riskLevel", "riskScore", signals
FROM login_attempts
ORDER BY "createdAt" DESC
LIMIT 20;
```

## How a login is checked

```
POST /auth/login
  AuthService.login
    1. assertNotLocked()     email or IP locked? -> record a blocked attempt, 429
    2. verifyPassword()      Argon2 check (AuthService, unchanged)
    3. recordAttempt()
         a. save a LoginAttempt row (success or failure)
         b. classify the device: same, returning or new (read only)
         c. DETECT   run the 9 rules
         d. SCORE    combine them into one risk level
         e. PROTECT  lock email/IP (429), deny the token, or allow
         f. save the result on the attempt row and log it
         g. allowed login only: save or refresh the device
    4. rule 3 fired -> revoke every session of the user
    5. otherwise issue tokens as described in AUTH.md
```

Two details matter:

- **A locked email or IP never reaches the password check.** The attempt is still recorded, with `blocked = true`.
- **A device only becomes "known" after a login is allowed.** An attacker who is blocked or denied never gets their device saved.

## Endpoints

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/login` | Public | Unchanged request ([AUTH.md](./AUTH.md#post-authlogin)), now also runs detection |
| GET | `/devices` | JWT, any role | List my devices, most recently used first |
| PATCH | `/devices/:id/trust` | JWT, any role | Mark one of my devices as trusted |
| DELETE | `/devices/:id` | JWT, any role | Forget one of my devices |

### `POST /auth/login`: new responses

| Status | When |
|---|---|
| `200` | Login allowed. Low, medium and high risk logins are still allowed; they are recorded and logged. |
| `401 Invalid credentials` | Wrong password or unknown email, **or** the password was right but rule 3 denied the login. The message is identical in all three cases. |
| `429 Too many login attempts. Please try again later.` | The email or IP is locked, or this attempt caused a lock |

The response never says which rule fired. That information is only in the database and the server log, so an attacker learns nothing from it.

Optional request headers:

| Header | Used for |
|---|---|
| `User-Agent` | Browser, OS and device type for the device fingerprint |
| `X-Device-Id` | A stable ID the client generates once per install (8-128 characters: letters, digits, `-`, `_`). Makes the fingerprint unique per install. |
| `CF-IPCountry`, `CloudFront-Viewer-Country`, `X-Country-Code` | Country of the client. **Only read when `TRUST_PROXY` is set** (see [Configuration](#configuration)). |

### `GET /devices`

```json
[
  {
    "id": "33c29901-6fad-4f0f-b602-cbe0561a89db",
    "userId": "60650b2c-b4d3-440e-b295-09a7bff5058c",
    "fingerprint": "0fbce529c207011a8e975702f47594c8f34095aec598b96554c0f23dd5644f53",
    "name": "Chrome on Windows",
    "ipAddress": "203.0.113.7",
    "location": "KH",
    "firstSeenAt": "2026-11-11T04:14:23.219Z",
    "lastSeenAt": "2026-11-11T04:14:23.219Z",
    "isTrusted": false
  }
]
```

- New devices are saved with `isTrusted: false`.
- `location` is the last known country code, or `null` when unknown.

### `PATCH /devices/:id/trust`

Responses: `200` with the updated device, `404` if the device doesn't exist **or belongs to someone else** (so device IDs can't be probed), `400` if `:id` is not a UUID.

### `DELETE /devices/:id`

Responses: `204`, `404` as above. The device is forgotten, so the next login from it counts as a new device again. Use it when a device is lost or sold.

## The 9 rules

Rule numbers follow [SPECS.md section 7](../SPECS.md#7-detection-rules).

| # | Rule | Fires when | Severity | Response |
|---|---|---|---|---|
| 1 | Brute force | 20+ failed logins for one email **or** from one IP in 60 s | HIGH | Lock that email and/or IP for 15 min, answer 429 |
| 2 | New device / new country | Successful login from a device or a country never seen for this user | MEDIUM each. **HIGH** if both, or a new device after recent failures. | Device saved as untrusted |
| 3 | Possible compromise | Correct password after 5+ failures for that user in 10 min | CRITICAL | No token (`401`), and **every session of the user is revoked** |
| 4 | Credential stuffing | 10+ different emails tried from one IP in 10 min | HIGH | Lock the IP for 15 min, answer 429 |
| 5 | Account enumeration | 5+ failures on emails that don't exist, from one IP in 10 min | MEDIUM | None beyond the alert; the error message is the same for every failure anyway |
| 6 | Rapid logins | 5+ successful logins for one user in 60 s | LOW | Allowed |
| 7 | Login right after lockout | An attempt within 30 s of a lockout ending | MEDIUM | The next lockout of that target is doubled |
| 8 | New IP | Successful login from an IP this user has never logged in from | LOW | Merged into rule 2's alert when both fire |
| 9 | Unusual time | User has 10+ logins in the last 30 days and none at this hour | LOW | Allowed |
| - | Returning device (SPECS section 6) | A known device not used for 30+ days | LOW | Allowed |

### Rules in detail

- **First login.** A user's very first successful login is their baseline. Rules 2, 8 and 9 need history, so they never fire on it.
- **Merged alerts.** New device + new country is **one** HIGH alert, not two MEDIUMs. A new IP at the same time is folded into it (`related: ["new_country", "new_ip"]`). If rule 3 fires as well, everything is folded into the CRITICAL alert, and its message says the device or country is new.
- **Unknown country.** When no country header is available, the country is unknown and never counts as "new".
- **Unusual time** uses the user's `timezone` from registration, or UTC when it is empty.
- **No repeat alerts.** Rules 1, 4, 5 and 6 keep matching on every attempt once the threshold is passed. Only the first attempt in the time window raises the alert. The lockout still happens even when the alert is skipped.

### Scoring

Each fired rule adds points, and the total decides the level:

| Severity | Points | | Total score | Level |
|---|---|---|---|---|
| low | 10 | | 1+ | low |
| medium | 25 | | 20+ | medium |
| high | 50 | | 50+ | high |
| critical | 100 | | 100+ | critical |

The level is never lower than the highest single rule. Combining can only raise it, for example:

| Fired rules | Score | Level |
|---|---|---|
| new IP | 10 | low |
| new IP + unusual time | 20 | **medium** (SPECS: "new IP + unusual time becomes MEDIUM") |
| returning device + new IP | 20 | **medium** |
| brute force + credential stuffing | 100 | **critical** |

### Responses (Protect)

| Action | When | Result |
|---|---|---|
| `allow` | No rule fired | `200` |
| `allow_and_alert` | Some rule fired, no lock, not critical | `200`, recorded and logged |
| `block` | Rule 1 or 4 thresholds reached | Email and/or IP locked, `429` |
| `deny` | Correct password with CRITICAL risk (rule 3) | `401 Invalid credentials`, all sessions revoked |

### Lockouts

- A lockout targets an **email** (rule 1) or an **IP** (rules 1 and 4).
- While it is active, every login for that email or from that IP gets `429`, even with the correct password.
- The first lockout lasts 15 minutes. Each earlier lockout of the same target in the last 24 hours doubles it: 15, 30, 60 minutes and so on, up to 24 hours.
- Lockouts end on their own. There is no unlock endpoint yet; to lift one early, delete the row from `lockouts`.

## Devices

A device is identified by a **fingerprint**: a SHA-256 hash of

- browser family (Chrome, Edge, Firefox, Safari, ...)
- OS family (Windows, macOS, iOS, Android, Linux, ...)
- device type (desktop, mobile, tablet)
- the `X-Device-Id` header, when the client sends one

Version numbers are ignored on purpose, so a browser update doesn't look like a new device.

| Classification | Meaning | Effect |
|---|---|---|
| Same | Known and used in the last 30 days | `lastSeenAt` updated, no alert |
| Returning | Known but unused for 30+ days | Updated, LOW alert |
| New | Never seen for this user | Saved as untrusted, rule 2 alert |

Without `X-Device-Id`, two people using the same browser on the same OS share a fingerprint. Clients should generate a random ID once per install and send it on every login.

## Where results go

Until the Alerts module exists (build step 2), detections are stored and logged rather than turned into alerts:

- **`login_attempts.signals`** holds every rule that fired on that attempt, with `riskScore` and `riskLevel` next to it.
- **The server log** gets one line per risky attempt. HIGH and CRITICAL are warnings:

```
WARN [LoginDetectorService] Login risk HIGH (score 50, action allow_and_alert) for analyst@example.com from 203.0.113.7: new_device(+new_country,new_ip)
WARN [LoginDetectorService] Login risk CRITICAL (score 100, action deny) for analyst@example.com from 203.0.113.7: possible_compromise
 LOG [LoginDetectorService] Login risk MEDIUM (score 25, action allow_and_alert) for ghost@example.com from 198.51.100.4: account_enumeration
```

A signal looks like this:

```json
{
  "rule": 2,
  "type": "new_device",
  "severity": "high",
  "message": "Successful login from a new device and new country",
  "related": ["new_country", "new_ip"]
}
```

Signal types: `brute_force`, `new_device`, `new_country`, `possible_compromise`, `credential_stuffing`, `account_enumeration`, `rapid_logins`, `post_lockout_attempt`, `new_ip`, `unusual_time`, `returning_device`.

When alerts arrive, only `LoginDetectorService.report()` needs to change: each signal becomes an Alert and a notification job.

## Database tables

### `login_attempts`

One row per `POST /auth/login`. Every rule reads from it.

| Column | Notes |
|---|---|
| `userId` | Null when the email doesn't belong to anyone. Set to null if the user is deleted. |
| `email` | As typed, lower-cased. Kept even for unknown emails (needed by rules 4 and 5). |
| `ip`, `country`, `deviceFingerprint`, `userAgent` | From the request |
| `success` | Password matched |
| `emailExists` | The email belongs to a user |
| `blocked` | Rejected by a lockout before the password was checked |
| `riskScore`, `riskLevel`, `signals` | Detection result |
| `createdAt` | |

Indexed on `(email, createdAt)`, `(ip, createdAt)` and `(userId, createdAt)`, which are exactly the lookups the rules make. Blocked attempts are left out of the rule counts, so a locked attacker can't keep re-triggering alerts.

### `devices`

| Column | Notes |
|---|---|
| `userId` | Deleted with the user |
| `fingerprint` | Unique per user |
| `name` | For example `Chrome on Windows` |
| `ipAddress`, `location` | Last IP and country it logged in from |
| `firstSeenAt`, `lastSeenAt` | |
| `isTrusted` | `false` until the user trusts it |

### `lockouts`

| Column | Notes |
|---|---|
| `targetType` | `email` or `ip` |
| `target` | The locked email or IP |
| `ip` | IP of the attempt that caused it |
| `reason` | `brute_force` or `credential_stuffing` |
| `lockedUntil` | Indexed with `target` |

## Configuration

No new variables. Login detection uses the existing ones from [AUTH.md](./AUTH.md#configuration).

**`TRUST_PROXY`** matters more here: rules 1, 4, 5 and 8 depend on the client IP, and rule 2 on the country.

- When it is set, the IP comes from `X-Forwarded-For` and the country headers are read.
- When it is not set, the IP is the direct connection and the country is always unknown, so "new country" never fires.

Never set it when clients connect directly. Anyone could then fake their IP and country and dodge the rules.

Thresholds live in `LOGIN_RULES` at the top of `src/auth/detection/login-rules.ts`:

```ts
export const LOGIN_RULES = {
  bruteForce: { threshold: 20, windowSeconds: 60, lockMinutes: 15 },
  possibleCompromise: { threshold: 5, windowSeconds: 600 },
  credentialStuffing: { threshold: 10, windowSeconds: 600, lockMinutes: 15 },
  accountEnumeration: { threshold: 5, windowSeconds: 600 },
  rapidLogins: { threshold: 5, windowSeconds: 60 },
  postLockout: { graceSeconds: 30 },
  unusualTime: { lookbackDays: 30, minLogins: 10 },
  returningDevice: { inactiveDays: 30 },
  lockoutEscalation: { lookbackHours: 24, maxMinutes: 1440 },
};
```

Score weights and level thresholds are next to it (`SEVERITY_WEIGHTS`, `SCORE_THRESHOLDS`).

## Security measures

| Area | Measure |
|---|---|
| Brute force across many IPs | Per-email lockout (rule 1), on top of the per-IP rate limit in AUTH.md |
| One IP attacking many accounts | Per-IP lockout (rules 1 and 4) |
| Stolen password | Rule 3 refuses the token and revokes every session |
| Account enumeration | Same message for every failure. Rule 5 flags the attempt. |
| Leaking detection logic | Responses never say which rule fired |
| Lockout bypass | Locked targets are rejected before the password check, even with the right password |
| Attacker device becoming trusted | Devices are saved only after an allowed login, and always as untrusted |
| Device ID probing | Other users' devices return 404, not 403 |
| IP / country spoofing | Proxy headers are only trusted with `TRUST_PROXY` |
| Alert flooding | Window rules alert once per window. Blocked attempts are not counted. |

## Testing

```bash
npm run test    # includes the login detection unit tests
```

| File | Covers |
|---|---|
| `src/auth/detection/login-rules.spec.ts` | Every rule's threshold and severity, merged alerts, first-login baseline, scoring, lock decisions, lockout doubling, timezone hours |
| `src/devices/fingerprint.spec.ts` | User-agent parsing, version updates ignored, device ID handling |
| `src/auth/auth.service.spec.ts` | Login calls detection, a denied login revokes sessions, a locked login stops before the password check |

The rules are pure functions with no database, so they can be tested with plain objects. `LoginDetectorService` only collects the counts from the database and passes them in.

To try rules by hand without real proxies, run with `TRUST_PROXY=1` and send `X-Forwarded-For` and `CF-IPCountry` headers to simulate different IPs and countries.

## Known limitations

| Limitation | Plan |
|---|---|
| Detections are not saved as Alerts and no notification is sent | Alerts module (build step 2) and notifications queue (step 4). Only `report()` changes. |
| Thresholds are constants in code | Move them to the `AlertRule` table (step 4) so they can be tuned without a deploy |
| No country without a proxy header | Add a GeoIP lookup |
| The per-IP part of rule 1 (20 failures from one IP in 60 s) can't trigger, because `/auth/login` allows only 5 attempts per minute per IP | Lower the threshold, or rely on rules 4 and 5 for single-IP attacks |
| An attacker can lock a real user out for 15 minutes by failing 20 times on their email | Accepted for now, as in the spec. Options: lock per email + IP pair instead, or add CAPTCHA/MFA. |
| No unlock endpoint for admins | Add `DELETE /lockouts/:id` for admins if needed |
| Without `X-Device-Id`, the same browser and OS look like one device | Clients should send `X-Device-Id` |
| Rule counts are not locked against parallel requests, so two simultaneous attempts may both see the count just below a threshold | Acceptable; the next attempt triggers it |

## Where the code lives

```
src/
├── auth/
│   ├── login-detection.module.ts       wires login detection; AuthModule imports it
│   ├── login-detector.service.ts       the hooks AuthService calls; gathers facts, applies the result
│   ├── lockout.service.ts              create and look up lockouts, doubling
│   ├── detection/
│   │   ├── login-rules.ts              the 9 rules, scoring and decisions (pure functions, thresholds)
│   │   ├── login-rules.spec.ts
│   │   └── request-context.ts          IP, user agent, country, device ID from the request
│   ├── entities/
│   │   ├── login-attempt.entity.ts
│   │   └── lockout.entity.ts
│   ├── auth.service.ts                 login() calls assertNotLocked() and recordAttempt()
│   └── auth.controller.ts              passes the request context to login()
├── devices/
│   ├── devices.module.ts / controller / service
│   ├── fingerprint.ts                  user-agent parsing and fingerprint
│   ├── fingerprint.spec.ts
│   └── entities/device.entity.ts
└── migrations/
    └── 1762860000000-CreateLoginDetection.ts   devices, login_attempts, lockouts
```
