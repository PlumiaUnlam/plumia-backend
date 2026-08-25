CREATE INDEX IF NOT EXISTS "idx_chunk_project_updated"
  ON "chunk" ("project_id", "updated_at");
