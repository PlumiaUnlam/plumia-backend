CREATE TYPE "KnowledgeReviewMode" AS ENUM ('MANUAL', 'AUTO_THRESHOLD');
CREATE TYPE "StateProposalSequenceKind" AS ENUM ('TRANSITION', 'CONTRADICTION', 'UNCERTAIN');
CREATE TYPE "KnowledgeAnalysisRunStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'NO_CHANGES'
);
CREATE TYPE "KnowledgeAnalysisSceneStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'NO_CHANGES'
);

CREATE TABLE "project_knowledge_review_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "state_review_mode" "KnowledgeReviewMode" NOT NULL DEFAULT 'MANUAL',
  "state_confidence_threshold" DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  "relationship_review_mode" "KnowledgeReviewMode" NOT NULL DEFAULT 'MANUAL',
  "relationship_confidence_threshold" DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_knowledge_review_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_knowledge_review_settings_project_id_key"
  ON "project_knowledge_review_settings"("project_id");
ALTER TABLE "project_knowledge_review_settings"
  ADD CONSTRAINT "project_knowledge_review_settings_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "knowledge_analysis_run" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "status" "KnowledgeAnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
  "total_scenes" INTEGER NOT NULL DEFAULT 0,
  "processed_scenes" INTEGER NOT NULL DEFAULT 0,
  "failed_scenes" INTEGER NOT NULL DEFAULT 0,
  "total_chunks" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_analysis_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_knowledge_run_project_status"
  ON "knowledge_analysis_run"("project_id", "status");
ALTER TABLE "knowledge_analysis_run"
  ADD CONSTRAINT "knowledge_analysis_run_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_analysis_run"
  ADD CONSTRAINT "knowledge_analysis_run_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "knowledge_analysis_run_scene" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "scene_id" UUID NOT NULL,
  "narrative_position" INTEGER NOT NULL,
  "status" "KnowledgeAnalysisSceneStatus" NOT NULL DEFAULT 'QUEUED',
  "total_chunks" INTEGER NOT NULL DEFAULT 0,
  "processed_chunks" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_analysis_run_scene_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "knowledge_analysis_run_scene_run_id_scene_id_key"
  ON "knowledge_analysis_run_scene"("run_id", "scene_id");
CREATE INDEX "idx_knowledge_run_scene_status"
  ON "knowledge_analysis_run_scene"("run_id", "status");
ALTER TABLE "knowledge_analysis_run_scene"
  ADD CONSTRAINT "knowledge_analysis_run_scene_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "knowledge_analysis_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_analysis_run_scene"
  ADD CONSTRAINT "knowledge_analysis_run_scene_scene_id_fkey"
  FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entity_state_proposal"
  ADD COLUMN "narrative_order" INTEGER;
ALTER TABLE "entity_state_proposal"
  ADD COLUMN "sequence_kind" "StateProposalSequenceKind";
ALTER TABLE "relationship_proposal"
  ADD COLUMN "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0;
