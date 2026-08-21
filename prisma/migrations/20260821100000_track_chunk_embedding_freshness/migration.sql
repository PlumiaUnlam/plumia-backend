ALTER TABLE "chunk"
  ADD COLUMN "embedding_content_hash" VARCHAR(64),
  ADD COLUMN "embedding_model" VARCHAR(100);

CREATE INDEX "idx_chunk_embedding_freshness"
  ON "chunk" ("project_id", "embedding_content_hash", "embedding_model");

-- La migracion 20260624002205 elimino el indice vectorial original. HNSW
-- conserva buen recall aun cuando los embeddings se cargan incrementalmente.
CREATE INDEX IF NOT EXISTS "idx_chunk_embedding"
  ON "chunk" USING hnsw ("embedding" vector_cosine_ops);
