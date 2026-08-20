CREATE TYPE "ImageGenerationJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "image_generation_job" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entity_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "instructions" JSONB NOT NULL DEFAULT '{}',
  "reference_image_id" UUID,
  "reference_image_url" VARCHAR(1000),
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "seed" INTEGER NOT NULL,
  "status" "ImageGenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "bull_job_id" VARCHAR(150),
  "generated_image_id" UUID,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "image_generation_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "image_generation_job_generated_image_id_key"
  ON "image_generation_job"("generated_image_id");
CREATE INDEX "idx_image_job_entity_created"
  ON "image_generation_job"("entity_id", "created_at");
CREATE INDEX "idx_image_job_user_created"
  ON "image_generation_job"("user_id", "created_at");
CREATE INDEX "idx_image_job_status"
  ON "image_generation_job"("status");

ALTER TABLE "image_generation_job"
  ADD CONSTRAINT "image_generation_job_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "image_generation_job"
  ADD CONSTRAINT "image_generation_job_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "image_generation_job"
  ADD CONSTRAINT "image_generation_job_generated_image_id_fkey"
  FOREIGN KEY ("generated_image_id") REFERENCES "generated_image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
