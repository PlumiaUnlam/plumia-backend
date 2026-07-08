ALTER TABLE "storyboard_note"
  ADD COLUMN "title" VARCHAR(200) NOT NULL DEFAULT 'Untitled scene',
  ADD COLUMN "status" VARCHAR(50) NOT NULL DEFAULT 'ideas',
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "characters" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_note_status" ON "storyboard_note"("status");
CREATE INDEX "idx_note_deleted" ON "storyboard_note"("deleted_at");
