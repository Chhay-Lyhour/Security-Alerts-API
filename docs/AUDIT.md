# Audit Trail (PAM)

This covers how privileged actions are recorded and reviewed. It is build step 5 in [SPECS.md](../SPECS.md): "AuditLog on every status change, `GET /audit`". It goes further, as the privileged access management (PAM) side of the project: every admin and analyst action is recorded, including attempts that were refused.

## Quick start

1. Create the table: `npm run migration:run` (adds `audit_logs`; Docker does this on start)
2. Do something privileged, e.g. acknowledge an alert
3. As an admin: `GET /audit`

```bash
curl -s "localhost:3000/audit?action=acknowledged_alert" -H "Authorization: Bearer $ADMIN_TOKEN"
```

```json
{
  "data": [
    {
      "id": "…", "userId": "…", "actorEmail": "analyst@lotus.demo", "actorRole": "analyst",
      "action": "acknowledged_alert", "outcome": "success",
      "targetType": "alert", "targetId": "b534…",
      "method": "PATCH", "path": "/alerts/b534…/status", "statusCode": 200,
      "ip": "172.18.0.1", "metadata": { "status": "acknowledged" },
      "createdAt": "2026-11-11T13:05:30.120Z"
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

## What gets recorded

| Action | Route | Target |
|---|---|---|
| `created_source` | `POST /sources` | source |
| `created_rule` / `updated_rule` | `POST /rules`, `PATCH /rules/:id` | rule |
| `acknowledged_alert` / `resolved_alert` | `PATCH /alerts/:id/status` | alert |
| `deleted_alert` | `DELETE /alerts/:id` | alert |
| `trusted_device` / `revoked_device` | `PATCH /devices/:id/trust`, `DELETE /devices/:id` | device |
| `blocked_ip` / `unblocked_ip` | `POST /firewall/blocked-ips`, `DELETE /firewall/blocked-ips/:id` | blocked_ip |
| `auto_blocked_ip` | none (the firewall did it, `actorRole: system`) | blocked_ip |
| `access_denied` | any other route answered with 403 to a logged-in user | |

Each row has an **outcome**:

| Outcome | Status | Example |
|---|---|---|
| `success` | 2xx | The analyst acknowledged the alert |
| `denied` | 401 / 403 | An analyst tried to delete an alert |
| `failed` | anything else | Resolving an already-resolved alert (409), unknown id (404) |

Anonymous requests are not recorded. Without a token the API answers 404, and recording those would let anyone fill the table.

## Filters for `GET /audit` (admin only)

| Query | Example |
|---|---|
| `userId` | `?userId=<uuid>`: everything one person did |
| `action` | `?action=deleted_alert` |
| `outcome` | `?outcome=denied`: all refused attempts |
| `targetType`, `targetId` | `?targetId=<alert id>`: the history of one alert |
| `from`, `to` | ISO 8601 dates |
| `page`, `limit` | `limit` is 1–100, default 20 |

Results are newest first.

## Design choices

- **No controller has to remember to log.** `AuditMiddleware` waits for each response to finish, then checks the route against `PRIVILEGED_ROUTES` in [`audit-actions.ts`](../src/audit/audit-actions.ts). Only then are the logged-in user, matched route and status code all known. To audit a new route, add one line there.
- **Allowlisted fields only.** Each route lists the request fields worth keeping (e.g. `status`, `threshold`). Anything else is dropped, so passwords, tokens and API keys can never end up in the trail. A new source's API key is in the response, but only the source's `id` is read from it.
- **Append-only.** A Postgres trigger rejects every `UPDATE` and `DELETE` on `audit_logs`, even through the app's own database account. There are no update or delete routes either.
- **Survives deletions.** There's no foreign key to `users`, and the actor's email and role are copied onto each row. Deleting a user doesn't erase or rewrite what they did.
- **Never breaks a request.** The row is written after the response is sent. If the write fails, it is logged as an error and the user's action stands.
