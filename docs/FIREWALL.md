# Firewall / IP Filter

The firewall is a blocklist of IPs and CIDR ranges, used in two places:

1. **In front of this API.** `FirewallMiddleware` runs before every route, ahead of guards. A blocked IP gets `403 Access denied` before it can try a password, token or API key.
2. **As a service for integrated apps.** An app asks `POST /firewall/check` before letting a visitor in, so the attacker is stopped at the app's own door (see [`demo/bank-app`](../demo/bank-app/server.mjs)).

IPs are blocked by an admin, or automatically when the rule engine escalates a **high** or **critical** alert for an IP.

## Quick start

1. Create the table: `npm run migration:run` (adds `blocked_ips`; Docker does this on start)
2. Block an IP:

```bash
curl -s -X POST localhost:3000/firewall/blocked-ips -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ip":"203.0.113.0/24","reason":"Scanner range","expiresInMinutes":120}'
```

3. From an integrated app, with its source API key:

```bash
curl -s -X POST localhost:3000/firewall/check -H "x-api-key: $API_KEY" \
  -H 'Content-Type: application/json' -d '{"ip":"203.0.113.50"}'
# {"ip":"203.0.113.50","blocked":true,"reason":"Scanner range","expiresAt":"…"}
```

## Routes

| Method | Route | Auth | Body / result |
|---|---|---|---|
| POST | `/firewall/check` | API key | `{ ip }` → `{ ip, blocked, reason, expiresAt }` |
| POST | `/firewall/blocked-ips` | admin | `{ ip, reason?, expiresInMinutes? }`. `ip` is a single address or a CIDR range. Without `expiresInMinutes` the block is permanent |
| GET | `/firewall/blocked-ips` | admin | Active blocks, newest first |
| DELETE | `/firewall/blocked-ips/:id` | admin | 204 |

Adding and removing blocks is recorded in the [audit trail](./AUDIT.md) (`blocked_ip`, `unblocked_ip`, `auto_blocked_ip`).

## Automatic blocking

```
alerts from one IP ─► rule engine: threshold hit ─► escalated alert (high/critical)
                                                         │ alert.created
                                                         ▼
                                AutoBlockListener ─► block IP for FIREWALL_AUTO_BLOCK_MINUTES
                                                  └► audit: auto_blocked_ip (actor: system)
```

- Only **escalations** count, not raw ingested alerts. A single event marked `critical` can't get anyone blocked; a rule an admin created has to fire.
- An IP that is already blocked or on the allowlist is skipped.
- The block expires on its own. The default is 60 minutes; `FIREWALL_AUTO_BLOCK_MINUTES=0` turns automatic blocking off.

## Safety rails

| Rule | Why |
|---|---|
| Nothing wider than `/8` (IPv4) or `/32` (IPv6) | `0.0.0.0/0` would cut off everyone |
| An admin can't block a range containing their own IP | So nobody locks themselves out |
| `FIREWALL_ALLOWLIST` entries can never be blocked | Your office, or the servers of integrated apps |
| Blocked callers just get `403 Access denied` | No hint of why or for how long |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FIREWALL_AUTO_BLOCK_MINUTES` | `60` | Length of automatic blocks; `0` = off |
| `FIREWALL_ALLOWLIST` | empty | Comma-separated IPs/CIDRs that are never blocked |
| `TRUST_PROXY` | empty | Behind a reverse proxy, the number of hops to trust, so the real client IP is used |

## How it performs

The active blocklist is held in memory and matched with Node's `net.BlockList`, so checking a request never touches the database. Changes apply at once on the instance that made them. Each instance also reloads the list every 15 seconds, which picks up changes from other instances and drops expired blocks.
