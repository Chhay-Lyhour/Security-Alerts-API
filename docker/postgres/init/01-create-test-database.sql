-- Runs once, the first time the Postgres volume is created.
-- The e2e tests refuse to run against any database whose name doesn't end in _test.
CREATE DATABASE security_alerts_test;
