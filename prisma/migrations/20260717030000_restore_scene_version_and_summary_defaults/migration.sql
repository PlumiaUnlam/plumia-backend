-- Restore defaults required by scene version creation and summary jobs

ALTER TABLE "scene_version"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "summary_generation_job"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
