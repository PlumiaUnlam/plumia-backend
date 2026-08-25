DROP INDEX IF EXISTS "idx_chunk_embedding";

CREATE INDEX IF NOT EXISTS "idx_chunk_embedding"
  ON "chunk" USING ivfflat ("embedding" vector_cosine_ops);
