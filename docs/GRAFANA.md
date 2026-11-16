# Grafana dashboard

A live dashboard for the Security Alerts API. Grafana reads the same PostgreSQL database the API writes to, through a **read-only** login, and refreshes every 10 seconds.

| Panel | Shows |
|---|---|
| Stat tiles | Alerts in the time range, open alerts, open high/critical, IPs blocked right now, notifications sent and failed |
| Alerts over time by severity | Stacked bars: 🔵 low, 🟡 medium, 🟠 high, 🔴 critical (same colors as the Telegram messages). Red dashed lines mark firewall blocks. |
| Alerts by type | `failed_login`, `new_device`, `impossible_travel`, ... |
| Top attacking IPs | IPs with the most alerts, and whether each one is blocked now |
| Firewall: active blocks | Network, auto or manual, reason, expiry |
| Latest alerts | The last 100 alerts with severity, source and status |
| Notifications by channel / Notification errors | Sent, pending and failed per channel, with Telegram's error message |
| Audit log | Who did what, and whether it was allowed |

The **Source** and **Severity** drop-downs at the top filter the alert panels.

## Start it

Grafana is part of `docker-compose.yml`, so it starts with everything else:

```bash
docker compose up -d
```

Open **http://localhost:3030** and sign in with `admin` / `admin` (change these with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` in `.env` before the first start). The **Security Alerts** dashboard is the home page.

To see it move, run the demo: `npm run demo:setup` once, then 5 wrong passwords on the bank at http://localhost:4000. The alerts, the escalation and the block appear within 10 seconds.

## How it's wired

```
docker compose up
  postgres ──► api (runs migrations) ──► grafana-init ──► grafana :3030
```

1. **`grafana-init`** is a one-shot container. Once the API is healthy (so its tables exist), it runs [`docker/grafana/grant-reader.sql`](../docker/grafana/grant-reader.sql), which creates the `grafana_reader` Postgres login and gives it `SELECT` on `alerts`, `blocked_ips`, `notifications`, `audit_logs`, `alert_rules` and four columns of `sources`. It can't read `users` (password hashes), `refresh_tokens` or API key hashes, and every session is read-only. The script is safe to run again; it runs on every `up`.
2. **`grafana`** loads the data source from `docker/grafana/provisioning/datasources/postgres.yml` and the dashboard from `docker/grafana/dashboards/security-alerts.json`.

## Change the dashboard

The dashboard is provisioned from the JSON file, so changes made in the browser can't be saved over it. To change it:

1. Edit the panel in the browser, then **Save dashboard → Save JSON to file** (or **Export → Export as JSON**).
2. Replace `docker/grafana/dashboards/security-alerts.json` with it. Grafana reloads the file within 30 seconds.

Every panel is a plain SQL query (click a panel title → **Edit**), so it's also a good place to try queries against the data.

## Settings (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `GRAFANA_HOST_PORT` | `3030` | Port on your machine |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | `admin` / `admin` | Grafana login, used on the first start only (afterwards, change it in Grafana) |
| `GRAFANA_DB_PASSWORD` | `grafana-reader-password` | Password of the `grafana_reader` database login |

## Troubleshooting

| Problem | Fix |
|---|---|
| `grafana` doesn't start and `docker compose ps -a` shows `grafana-init` exited with an error | `docker compose logs grafana-init`. Usually the API isn't healthy yet: fix the API first (`docker compose logs api`). |
| Panels say `permission denied for table ...` | A panel queries a table `grafana_reader` can't read. Add a `GRANT SELECT` to `grant-reader.sql` and run `docker compose up -d grafana-init`. |
| Panels say `password authentication failed for user "grafana_reader"` | `GRAFANA_DB_PASSWORD` changed. Run `docker compose up -d --force-recreate grafana-init grafana`. |
| Can't sign in with admin / admin | The password was changed in Grafana, or `GRAFANA_ADMIN_PASSWORD` was set. Reset it: `docker compose exec grafana grafana cli admin reset-admin-password <new>`. |
| Panels are empty | No data in the time range. Widen it (top right), or run the demo. |
| Port 3030 is taken | Set `GRAFANA_HOST_PORT` in `.env`. |
