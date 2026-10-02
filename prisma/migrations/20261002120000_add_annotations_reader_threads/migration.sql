-- HU-09: keep private author annotations separate from comments on a frozen share.

ALTER TABLE "reader_comment"
  ADD COLUMN "version_id" UUID,
  ADD COLUMN "resolved_by_id" TEXT;

UPDATE "reader_comment" AS comment
SET "version_id" = share."version_id"
FROM "share_link" AS share
WHERE comment."share_link_id" = share."id"
  AND share."version_id" IS NOT NULL;

CREATE INDEX "idx_comment_version" ON "reader_comment"("version_id");

ALTER TABLE "reader_comment"
  ADD CONSTRAINT "reader_comment_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "version"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "reader_comment_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "author_annotation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scene_id" UUID NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "quote" TEXT,
  "anchor_from" INTEGER,
  "anchor_to" INTEGER,
  "context_before" VARCHAR(200),
  "context_after" VARCHAR(200),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "author_annotation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_author_annotation_scene"
  ON "author_annotation"("scene_id", "deleted_at", "created_at");
CREATE INDEX "idx_author_annotation_author"
  ON "author_annotation"("author_id");

ALTER TABLE "author_annotation"
  ADD CONSTRAINT "author_annotation_scene_id_fkey"
    FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "author_annotation_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reader_comment_reply" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "comment_id" UUID NOT NULL,
  "author_id" TEXT,
  "display_name" VARCHAR(100) NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_comment_reply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_reader_comment_reply_thread"
  ON "reader_comment_reply"("comment_id", "created_at");

ALTER TABLE "reader_comment_reply"
  ADD CONSTRAINT "reader_comment_reply_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "reader_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reader_comment_reply_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "reader_comment_status_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "comment_id" UUID NOT NULL,
  "status" "ReaderCommentStatus" NOT NULL,
  "changed_by_id" TEXT,
  "changed_by_name" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_comment_status_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_reader_comment_status_history"
  ON "reader_comment_status_event"("comment_id", "created_at");

ALTER TABLE "reader_comment_status_event"
  ADD CONSTRAINT "reader_comment_status_event_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "reader_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "reader_comment_status_event_changed_by_id_fkey"
    FOREIGN KEY ("changed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the state of existing threads as the starting point for their history.
INSERT INTO "reader_comment_status_event" (
  "comment_id", "status", "changed_by_name", "created_at"
)
SELECT "id", "status", 'Estado previo (importado)', "created_at"
FROM "reader_comment";
