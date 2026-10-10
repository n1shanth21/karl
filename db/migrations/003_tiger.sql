-- Tiger Data features for the dashboard. Owner: Himagna (data branch).
-- 1. `events` becomes a Timescale HYPERTABLE: Postgres splits it into time chunks automatically,
--    so "events in the last hour" stays fast no matter how big the log gets.
-- 2. `events_hourly` is a CONTINUOUS AGGREGATE: a pre-computed "count per hour per event type" that
--    Timescale keeps up to date in the background. The dashboard's listings-per-hour chart reads it.
--    materialized_only = false ("real-time aggregation") also counts events newer than the last
--    refresh, so the current hour is live during the demo.
-- This file runs as one transaction (see src/db/pg/migrate.ts), so the aggregate is created WITH NO DATA;
-- the refresh policy fills it within a minute.

SELECT create_hypertable('events', by_range('ts'), if_not_exists => TRUE, migrate_data => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS events_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
  SELECT time_bucket('1 hour', ts) AS bucket, type, count(*)::int AS n
  FROM events
  GROUP BY time_bucket('1 hour', ts), type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('events_hourly',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
