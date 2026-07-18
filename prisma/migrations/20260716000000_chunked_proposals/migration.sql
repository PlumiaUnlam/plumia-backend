-- Chunked proposal reanalysis

ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'OBSOLETE';

ALTER TABLE "entity_proposal"
  ADD COLUMN IF NOT EXISTS "source_chunk_id" UUID,
  ADD COLUMN IF NOT EXISTS "source_chunk_hash" VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entity_proposal_source_chunk_id_fkey'
  ) THEN
    ALTER TABLE "entity_proposal"
      ADD CONSTRAINT "entity_proposal_source_chunk_id_fkey"
      FOREIGN KEY ("source_chunk_id")
      REFERENCES "chunk"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_proposal_source_chunk"
  ON "entity_proposal"("source_chunk_id");
