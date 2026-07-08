CREATE TABLE "storyboard_arc" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "source_type" VARCHAR(20) NOT NULL DEFAULT 'custom',
  "entity_id" UUID,
  "relationship_id" UUID,
  "sort_key" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "storyboard_arc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storyboard_matrix_note" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "arc_id" UUID NOT NULL,
  "chapter_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "sort_key" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "storyboard_matrix_note_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "storyboard_arc"
  ADD CONSTRAINT "storyboard_arc_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storyboard_matrix_note"
  ADD CONSTRAINT "storyboard_matrix_note_arc_id_fkey"
  FOREIGN KEY ("arc_id") REFERENCES "storyboard_arc"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_storyboard_arc_project" ON "storyboard_arc"("project_id");
CREATE INDEX "idx_storyboard_arc_entity" ON "storyboard_arc"("entity_id");
CREATE INDEX "idx_storyboard_arc_relationship" ON "storyboard_arc"("relationship_id");
CREATE INDEX "idx_storyboard_arc_sort" ON "storyboard_arc"("sort_key");
CREATE INDEX "idx_matrix_note_arc" ON "storyboard_matrix_note"("arc_id");
CREATE INDEX "idx_matrix_note_chapter" ON "storyboard_matrix_note"("chapter_id");
CREATE INDEX "idx_matrix_note_sort" ON "storyboard_matrix_note"("sort_key");
