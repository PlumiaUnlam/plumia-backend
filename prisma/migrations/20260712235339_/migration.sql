-- DropForeignKey
ALTER TABLE "relationship" DROP CONSTRAINT "relationship_valid_from_scene_id_fkey";

-- DropIndex
DROP INDEX "idx_note_deleted";

-- DropIndex
DROP INDEX "idx_note_status";

-- AlterTable
ALTER TABLE "scene_version" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "storyboard_arc" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "storyboard_matrix_note" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_valid_from_scene_id_fkey" FOREIGN KEY ("valid_from_scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
