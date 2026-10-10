-- Fast nearest-neighbour search on embeddings (pgvector HNSW, cosine distance). Owner: Himagna.
-- Safe on empty tables; at demo scale Postgres may still choose a plain scan, which is fine.
CREATE INDEX IF NOT EXISTS listings_embedding_idx ON listings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS wants_embedding_idx ON wants USING hnsw (embedding vector_cosine_ops);
