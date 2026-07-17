-- AlterTable
ALTER TABLE "scene_version" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "summary_generation_job" ALTER COLUMN "id" DROP DEFAULT;
