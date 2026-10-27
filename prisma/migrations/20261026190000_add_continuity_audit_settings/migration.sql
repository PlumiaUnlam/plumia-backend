CREATE TYPE "CrossChunkAuditMode" AS ENUM (
  'ADJACENT_CHUNKS',
  'SCENE_GROUPED',
  'PROJECT_SUMMARY',
  'DISABLED'
);

ALTER TABLE "project_knowledge_review_settings"
  ADD COLUMN "state_tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cross_chunk_audit_mode" "CrossChunkAuditMode" NOT NULL DEFAULT 'ADJACENT_CHUNKS';

CREATE TABLE "project_continuity_checkpoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "scene_id" UUID NOT NULL,
  "source_hash" VARCHAR(64) NOT NULL,
  "claims" JSONB NOT NULL DEFAULT '[]',
  "is_valid" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "project_continuity_checkpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_continuity_checkpoint_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_continuity_checkpoint_scene_id_fkey"
    FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_continuity_checkpoint_project_scene"
  ON "project_continuity_checkpoint"("project_id", "scene_id");

CREATE INDEX "idx_continuity_checkpoint_valid"
  ON "project_continuity_checkpoint"("project_id", "is_valid", "scene_id");
