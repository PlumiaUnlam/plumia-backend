-- AlterTable
ALTER TABLE "scene_version"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "summary_generation_job" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
