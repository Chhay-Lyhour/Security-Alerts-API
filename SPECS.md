# Security Alerts API: Blueprint

A backend-only security alert logging service built with **NestJS + PostgreSQL + BullMQ/Redis**. External systems send security events, a rule engine detects suspicious patterns, notifications go out, and analysts acknowledge or resolve alerts with a full audit trail.

---

## 1. Overview

- **Ingest:** `POST /alerts`, protected by an API key, takes events like failed logins, suspicious IPs or permission changes. Each event has a severity (low, medium, high, critical), a source, a timestamp and a JSON payload.
- **Storage:** PostgreSQL, with indexes on time and severity so filtering stays fast.
- **Query API:** `GET /alerts?severity=high&from=...` with pagination, plus `PATCH /alerts/:id/status` to mark an alert acknowledged or resolved.
- **Rules and notifications:** a BullMQ queue checks rules like "5 failed logins from one IP in 1 minute" and sends an email, Discord or Slack message.
- **Real-time (optional):** a WebSocket gateway can push new alerts to any client live.
- **Security:** JWT with `admin` and `analyst` roles, and an audit log of who acknowledged what.
- **Device and login detection:** tracks each user's known devices and login attempts to catch brute force, new devices, compromise and more (see section 6).

---

## 2. Entities

| Entity | Fields | Notes |
|---|---|---|
| **User** | id, email, passwordHash, role (`admin` \| `analyst`), timezone?, createdAt | |
| **Source** | id, name, apiKeyHash, isActive, createdAt | The system sending alerts. One Source has many Alerts. |
| **Alert** | id, title, severity (`low` \| `medium` \| `high` \| `critical`), type (e.g. `failed_login`, `port_scan`), ipAddress, payload (jsonb), status (`open` \| `acknowledged` \| `resolved`), sourceId, createdAt | Index on `createdAt` and `severity`. |
| **AlertRule** | id, name, type, threshold, windowSeconds, severity, isEnabled | e.g. "5 failed logins in 60s raises a high alert". Holds all thresholds so they change without code edits. |
| **Notification** | id, alertId, channel (`email` \| `slack` \| `discord`), status (`sent` \| `failed`), sentAt | |
| **AuditLog** | id, userId, action (e.g. `acknowledged_alert`), targetId, createdAt | |
| **Device** | id, userId, fingerprint, ipAddress, location, firstSeenAt, lastSeenAt, isTrusted | Fingerprint = hash of user-agent, OS, browser and optionally a client device ID. |
| **LoginAttempt** | id, userId (or email), ip, country, deviceFingerprint, success, emailExists, createdAt | Feeds all login detection rules. |
| **Lockout** | id, target (email or IP), ip, lockedUntil | Used for temporary blocks and the "login after lockout" rule. |

**MVP order:** start with User, Source and Alert. Then add AlertRule, Notification and AuditLog. Then Device, LoginAttempt and Lockout.

---

## 3. Directory structure

```
security-alerts-api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── data-source.ts
│   ├── common/
│   │   ├── guards/        (jwt-auth, roles, api-key)
│   │   ├── decorators/    (roles, current-user, public)
│   │   └── interceptors/  (logging)
│   ├── auth/
│   │   ├── auth.module.ts / controller / service
│   │   ├── jwt.strategy.ts
│   │   ├── login-detector.service.ts      (runs the 9 login rules)
│   │   ├── entities/      (login-attempt, lockout)
│   │   └── dto/           (login, register)
│   ├── users/
│   │   ├── users.module.ts / service
│   │   └── entities/user.entity.ts
│   ├── devices/
│   │   ├── devices.module.ts / controller / service
│   │   └── entities/device.entity.ts
│   ├── sources/
│   │   ├── sources.module.ts / controller / service
│   │   ├── dto/
│   │   └── entities/source.entity.ts
│   ├── alerts/
│   │   ├── alerts.module.ts / controller / service
│   │   ├── dto/           (create-alert, query-alerts, update-status)
│   │   ├── entities/alert.entity.ts
│   │   └── events/alert-created.event.ts
│   ├── rules/
│   │   ├── rules.module.ts / controller / service
│   │   ├── rule-engine.service.ts
│   │   └── entities/alert-rule.entity.ts
│   ├── notifications/
│   │   ├── notifications.module.ts / service
│   │   ├── notifications.processor.ts   (BullMQ worker)
│   │   └── entities/notification.entity.ts
│   ├── audit/
│   │   ├── audit.module.ts / service
│   │   └── entities/audit-log.entity.ts
│   └── migrations/
├── test/                  (e2e specs)
├── .env.example
├── Dockerfile
├── docker-compose.yml     (api + postgres + redis)
└── README.md
```

When an alert comes in, it is saved and an `alert.created` event fires. The rule engine checks the thresholds, and if a rule matches, a notification job goes on the queue.

---

## 4. Full flow

```
1. SETUP (admin)
   Admin ──POST /auth/login──► JWT
   Admin ──POST /sources (JWT)──► Source created, returns API key once
   Admin ──POST /rules (JWT)──► e.g. "5 failed_login / 60s → high"

2. INGEST (external system)
   App/Server ──POST /alerts + x-api-key──►
        ApiKeyGuard ── invalid ──► 401
             │ valid
        ValidationPipe ── bad body ──► 400
             │
        AlertsService.save()  ──► PostgreSQL (status = open)
             │
        emit "alert.created"
             │
             ▼
3. DETECT (async)
   RuleEngine listens
        ├─ count recent alerts (same type + IP, within window)
        ├─ below threshold ──► stop
        └─ threshold hit ──► create escalated Alert (rule severity)
                              └─► add job to BullMQ "notifications" (Redis)
             │
             ▼
4. NOTIFY (worker)
   NotificationsProcessor
        ├─ send Email / Slack / Discord
        ├─ success ──► Notification(status = sent)
        └─ fail ──► retry x3 ──► Notification(status = failed)

5. RESPOND (analyst)
   Analyst ──POST /auth/login──► JWT
   Analyst ──GET /alerts?severity=high&status=open&page=1──► list
   Analyst ──GET /alerts/:id──► detail (404 if missing)
   Analyst ──PATCH /alerts/:id/status {acknowledged|resolved}──►
        RolesGuard ── wrong role ──► 403
             │
        update Alert ──► write AuditLog(userId, action, alertId)

6. REVIEW (admin)
   Admin ──GET /audit──► who did what, when
   Admin ──DELETE /alerts/:id──► admin only

LOGIN DETECTION (on every login)
   POST /auth/login ──► record LoginAttempt ──► emit "login.attempted"
        └─► LoginDetector runs rules 1–9 ──► save Alert(s) ──► queue notification

ACROSS EVERYTHING
   LoggingInterceptor times every request
   Docker Compose runs: api + postgres + redis
```

---

## 5. Brief flow

1. **Setup:** an admin logs in, registers a source (which gets an API key) and creates detection rules.
2. **Ingest:** outside systems send alerts with that API key. They're checked, saved to Postgres and fire an event.
3. **Detect:** the rule engine checks thresholds, and if one is hit it escalates and queues a notification.
4. **Notify:** a worker sends the email, Slack or Discord message and retries if it fails.
5. **Respond:** analysts log in, filter alerts and mark them acknowledged or resolved, and each action is audit-logged.
6. **Review:** admins check the audit trail and manage alerts.

---

## 6. Device detection

On each login or ingest event:

1. Build the fingerprint from the request.
2. Look it up for that user and classify it:
   - **Same device:** seen recently. Update `lastSeenAt`, no alert.
   - **Old device:** known but not seen in 30+ days. Update it and raise a **low** "returning device" alert.
   - **New device:** never seen. Save with `isTrusted = false` and raise a **medium** "new device login" alert. This becomes **high** if the IP's country also changed or there were recent failed logins.
3. The alert goes through the same rule engine and notification flow.

---

## 7. Detection rules

All rules run on every login attempt using `LoginAttempt` (plus `Device` and `Lockout`). Thresholds live in `AlertRule` so they can be tuned without code changes.

| # | Rule | Alert type | Logic | Severity | Response |
|---|---|---|---|---|---|
| 1 | Brute force | `brute_force` | ≥ 20 failed attempts for the same email **or** IP in the last 60s | **HIGH** | Optionally lock account / block IP for 15 min, return 429 |
| 2 | New device or new country | `new_device` / `new_country` | After a successful login, fingerprint not in user's devices, or country not seen before | **MEDIUM** each; **HIGH** if both (single alert) | Save device as untrusted |
| 3 | Success after many failures | `possible_compromise` | On success, ≥ 5 failures for that user in the last 10 min | **CRITICAL** | Force password reset or revoke session. If also new device/country, stays critical and the note says so |
| 4 | Credential stuffing | `credential_stuffing` | ≥ 10 *distinct* emails tried from one IP in 10 min | **HIGH** | Temporarily block the IP |
| 5 | Account enumeration | `account_enumeration` | ≥ 5 failures on non-existent emails (`emailExists = false`) per IP in 10 min | **MEDIUM** | Always return the same "invalid credentials" message |
| 6 | Rapid repeated logins | `rapid_logins` | ≥ 5 successes for the same user in 60s | **LOW** | |
| 7 | Login right after lockout | `post_lockout_attempt` | Attempt arrives within ~30s after `lockedUntil` | **MEDIUM** | Consider doubling the next lock |
| 8 | New IP | `new_ip` | User has never had a successful login from this IP | **LOW** | Merge with rule 2 into one alert when both fire |
| 9 | Unusual time | `unusual_time` | Hour histogram from last 30 days of successes; this hour has 0 logins and user has ≥ 10 total | **LOW** | Use stored user timezone, or UTC consistently |

**Combining LOW alerts:** several LOW alerts on the same login can be merged into a higher severity. For example, new IP + unusual time becomes **MEDIUM**.

---

## 8. Routes

| Method | Route | Auth | Role | Purpose |
|---|---|---|---|---|
| POST | `/auth/register` | Public | | Create user |
| POST | `/auth/login` | Public | | Get JWT, records LoginAttempt |
| POST | `/sources` | JWT | admin | Register a source, returns API key once |
| GET | `/sources` | JWT | admin | List sources |
| POST | `/rules` | JWT | admin | Create a detection rule |
| GET / PATCH | `/rules`, `/rules/:id` | JWT | admin | List / update rules (thresholds, enable) |
| POST | `/alerts` | API key | | Ingest an alert |
| GET | `/alerts?severity=&status=&from=&to=&page=` | JWT | admin, analyst | Filter and paginate |
| GET | `/alerts/:id` | JWT | admin, analyst | Alert detail (404 if missing) |
| PATCH | `/alerts/:id/status` | JWT | admin, analyst | Acknowledge or resolve (audit-logged) |
| DELETE | `/alerts/:id` | JWT | admin | Delete alert |
| GET | `/audit` | JWT | admin | Audit trail |
| GET | `/devices` | JWT | any | My devices |
| PATCH | `/devices/:id/trust` | JWT | any | Mark device trusted |
| DELETE | `/devices/:id` | JWT | any | Revoke device |

---

## 9. Build order

1. **Auth:** User entity, register/login, JWT, roles guard.
2. **Sources + ingest:** Source entity, API key guard, `POST /alerts`.
3. **Alerts query + status:** filters, pagination, `PATCH /alerts/:id/status`.
4. **Rules + queue:** AlertRule, `alert.created` event, rule engine, BullMQ notifications worker.
5. **Audit:** AuditLog on every status change, `GET /audit`.
6. **Login detection:** LoginAttempt, Device, Lockout, and the 9 rules.
7. **Tests + Docker:** unit and e2e tests, Dockerfile, docker-compose (api + postgres + redis).
