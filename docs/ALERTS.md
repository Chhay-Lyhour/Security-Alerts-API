# Sources and alerts

Milestone 2 (Alerts & Ingest): external systems register as **sources**, send **alerts** with their API key, and analysts list, filter and update them.

Run `npm run migration:run` first. It adds the `alerts` table (migration `1762800000000-CreateAlerts`).

## Routes

| Method | Route | Auth | Role | Result |
|---|---|---|---|---|
| POST | `/sources` | JWT | admin | Creates a source and returns its API key **once** |
| GET | `/sources` | JWT | admin | Lists sources (never the key) |
| POST | `/alerts` | `x-api-key` | | Saves an alert with status `open`, fires `alert.created` |
| GET | `/alerts` | JWT | admin, analyst | Filtered, paginated list, newest first |
| GET | `/alerts/:id` | JWT | admin, analyst | One alert, 404 if missing |
| PATCH | `/alerts/:id/status` | JWT | admin, analyst | `acknowledged` or `resolved`, fires `alert.status_changed` |
| DELETE | `/alerts/:id` | JWT | admin | 204 |

## 1. Register a source (admin)

```bash
curl -X POST http://localhost:3000/sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"web-server-1"}'
```

```json
{ "id": "27f5…", "name": "web-server-1", "isActive": true, "createdAt": "…", "apiKey": "sa_4PYc…" }
```

Save `apiKey` now. Only its SHA-256 hash is stored, so it cannot be shown again. A duplicate name returns 409.

## 2. Send an alert (external system)

```bash
curl -X POST http://localhost:3000/alerts \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Failed login","severity":"high","type":"failed_login","ipAddress":"203.0.113.7","payload":{"user":"bob"}}'
```

| Field | Rules |
|---|---|
| `title` | required, up to 200 chars |
| `severity` | `low`, `medium`, `high` or `critical` |
| `type` | snake_case, e.g. `failed_login`, `port_scan` |
| `ipAddress` | optional, IPv4 or IPv6 |
| `payload` | optional JSON object, stored as `jsonb` |

The source is taken from the API key, so a `sourceId` in the body is rejected with 400. A missing or wrong key returns 401.

## 3. List and filter (analyst or admin)

```
GET /alerts?severity=high&status=open&type=failed_login&from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z&page=1&limit=20
```

All filters are optional: `severity`, `status`, `type`, `sourceId`, `ipAddress`, `from`, `to` (ISO 8601). `page` starts at 1, `limit` defaults to 20 and is capped at 100.

```json
{ "data": [ … ], "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 } }
```

## 4. Change status

```bash
curl -X PATCH http://localhost:3000/alerts/$ID/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"acknowledged"}'
```

Status only moves forward: `open → acknowledged → resolved`, or `open → resolved`. Anything else (for example `resolved → acknowledged`) returns 409. If two people change the same alert at once, the second gets 409.

## Events

| Event | Payload | Who listens |
|---|---|---|
| `alert.created` | `AlertCreatedEvent { alert }` | For now a listener that logs it. The rule engine (step 4) will check thresholds here. |
| `alert.status_changed` | `AlertStatusChangedEvent { alertId, userId, from, to }` | Nobody yet. The audit log (step 5) will record it. |

## Indexes

`alerts` has indexes on `createdAt`, `severity`, `status` and `sourceId`, so the common filters stay fast as the table grows.
