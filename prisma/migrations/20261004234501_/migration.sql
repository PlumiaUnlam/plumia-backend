-- AlterTable
ALTER TABLE "author_annotation" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "editor_text_style" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reader_comment" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reader_comment_reply" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reader_comment_status_event" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "share_link" ALTER COLUMN "updated_at" DROP DEFAULT;
