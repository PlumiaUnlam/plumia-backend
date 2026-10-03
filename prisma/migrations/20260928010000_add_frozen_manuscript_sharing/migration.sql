-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('READ_ONLY', 'COMMENT');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReaderCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "version"
  ALTER COLUMN "storage_key" DROP NOT NULL,
  ADD COLUMN "snapshot" JSONB;

-- AlterTable
ALTER TABLE "share_link"
  ADD COLUMN "token_hash" CHAR(64),
  ADD COLUMN "invited_email" VARCHAR(320),
  ADD COLUMN "permission" "SharePermission" NOT NULL DEFAULT 'READ_ONLY',
  ADD COLUMN "status" "ShareStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "accepted_by_id" TEXT,
  ADD COLUMN "accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "reader_comment"
  ADD COLUMN "snapshot_scene_id" UUID,
  ADD COLUMN "author_user_id" TEXT,
  ADD COLUMN "anchor_from" INTEGER,
  ADD COLUMN "anchor_to" INTEGER,
  ADD COLUMN "selected_text" TEXT,
  ADD COLUMN "prefix" VARCHAR(200),
  ADD COLUMN "suffix" VARCHAR(200),
  ADD COLUMN "status" "ReaderCommentStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "resolved_at" TIMESTAMPTZ(6);

ALTER TABLE "reader_comment" ALTER COLUMN "is_visible" SET DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "share_link_token_hash_key" ON "share_link"("token_hash");
CREATE INDEX "idx_share_recipient_status" ON "share_link"("invited_email", "status");
CREATE INDEX "idx_share_accepted_by" ON "share_link"("accepted_by_id");
CREATE INDEX "idx_comment_snapshot_scene" ON "reader_comment"("snapshot_scene_id");
CREATE INDEX "idx_comment_author" ON "reader_comment"("author_user_id");

-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "share_link" ADD CONSTRAINT "share_link_accepted_by_id_fkey"
  FOREIGN KEY ("accepted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reader_comment" ADD CONSTRAINT "reader_comment_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
