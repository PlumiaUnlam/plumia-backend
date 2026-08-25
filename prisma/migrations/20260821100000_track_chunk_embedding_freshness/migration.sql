ALTER TABLE "chunk"
  ADD COLUMN "embedding_content_hash" VARCHAR(64),
  ADD COLUMN "embedding_model" VARCHAR(100);

CREATE INDEX "idx_chunk_embedding_freshness"
  ON "chunk" ("project_id", "embedding_content_hash", "embedding_model");

-- Mantener el indice IVFFlat requerido para las busquedas vectoriales.
CREATE INDEX IF NOT EXISTS "idx_chunk_embedding"
  ON "chunk" USING ivfflat ("embedding" vector_cosine_ops);
