CREATE TABLE "editor_text_style" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "definition" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "editor_text_style_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "editor_text_style_project_name_key"
ON "editor_text_style"("project_id", "name");

CREATE INDEX "idx_editor_text_style_project"
ON "editor_text_style"("project_id");

ALTER TABLE "editor_text_style"
ADD CONSTRAINT "editor_text_style_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
