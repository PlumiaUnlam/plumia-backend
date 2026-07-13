CREATE TYPE "SummaryJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "summary"
  ADD COLUMN "source_content_hash" VARCHAR(64),
  ADD COLUMN "provider" VARCHAR(50),
  ADD COLUMN "model" VARCHAR(100);

DROP INDEX IF EXISTS "idx_summary_scope";
CREATE UNIQUE INDEX "uq_summary_scope" ON "summary"("scope_type", "scope_id");

CREATE TABLE "summary_generation_job" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "scope_type" VARCHAR(20) NOT NULL,
  "scope_id" UUID NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "status" "SummaryJobStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "force" BOOLEAN NOT NULL DEFAULT false,
  "bull_job_id" VARCHAR(150),
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "summary_generation_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "summary_generation_job_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_summary_job_input" ON "summary_generation_job"("scope_type", "scope_id", "input_hash");
CREATE INDEX "idx_summary_job_project" ON "summary_generation_job"("project_id");
CREATE INDEX "idx_summary_job_status" ON "summary_generation_job"("status");
