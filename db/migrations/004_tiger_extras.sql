-- Extra Tiger Data features. Owner: Himagna (data branch).
-- 1. pgvectorscale: Tiger's own vector extension. It adds the StreamingDiskANN index, which is built for
--    big vector tables and fast filtered search. We ADD it next to the pgvector HNSW indexes from 002
--    (not instead of them), so Postgres can pick whichever it likes. Rows with a NULL embedding
--    (not embedded yet) are simply left out of a diskann index, so no WHERE clause is needed. Safe on empty tables.
-- 2. Columnstore (compression) on the `events` hypertable: chunks older than 7 days are squeezed into a
--    compressed column format (usually 90%+ smaller) and stay queryable. We group by event type and order by
--    time. The continuous aggregate events_hourly keeps working on top of compressed data.
-- This file runs as one transaction (see src/db/pg/migrate.ts), so it only uses plain statements, no CALL.
-- The live app is using these tables: if a lock can't be had within 5 s, give up and roll back cleanly
-- instead of making the app's writes queue behind us.
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS vectorscale WITH SCHEMA public CASCADE;

CREATE INDEX IF NOT EXISTS listings_embedding_diskann ON listings USING diskann (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS wants_embedding_diskann ON wants USING diskann (embedding vector_cosine_ops);

ALTER TABLE events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'type',
  timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('events', INTERVAL '7 days', if_not_exists => TRUE);
