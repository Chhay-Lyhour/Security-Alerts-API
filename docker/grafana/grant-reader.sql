-- Creates (or updates) the read-only Postgres login Grafana uses.
-- Run by the grafana-init service on every `docker compose up`, after the API
-- has applied its migrations, so it is safe to run many times.
--
-- Grafana only gets SELECT on the tables the dashboard shows. It can't see
-- users (password hashes), refresh_tokens or the sources' API key hashes.

SELECT format('CREATE ROLE grafana_reader LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_reader')
\gexec

ALTER ROLE grafana_reader WITH LOGIN PASSWORD :'pw';
ALTER ROLE grafana_reader SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE :"db" TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;
GRANT SELECT ON alerts, blocked_ips, notifications, audit_logs, alert_rules TO grafana_reader;
GRANT SELECT (id, name, "isActive", "createdAt") ON sources TO grafana_reader;
