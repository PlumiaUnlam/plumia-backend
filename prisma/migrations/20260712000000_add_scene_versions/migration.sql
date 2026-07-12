CREATE TABLE "scene_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scene_id" UUID NOT NULL,
    "label" VARCHAR(200),
    "content" JSONB,
    "content_hash" VARCHAR(64),
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "created_from_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scene_version_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_scene_version_scene" ON "scene_version"("scene_id");
CREATE INDEX "idx_scene_version_created" ON "scene_version"("created_at");

ALTER TABLE "scene_version" ADD CONSTRAINT "scene_version_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
