CREATE TYPE "TimelineImpact" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "timeline_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "date" VARCHAR(200),
  "temporal_label" VARCHAR(200),
  "impact" "TimelineImpact" NOT NULL DEFAULT 'MEDIUM',
  "storyboard_arc_id" UUID,
  "position" DECIMAL(30, 12) NOT NULL,
  "source" VARCHAR(50) NOT NULL DEFAULT 'author_manual',
  "source_scene_id" UUID,
  "confidence_score" DECIMAL(3, 2) NOT NULL DEFAULT 1.0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "timeline_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_event_entity" (
  "timeline_event_id" UUID NOT NULL,
  "entity_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "timeline_event_entity_pkey" PRIMARY KEY ("timeline_event_id", "entity_id")
);

ALTER TABLE "timeline_event"
  ADD CONSTRAINT "timeline_event_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_event"
  ADD CONSTRAINT "timeline_event_storyboard_arc_id_fkey"
  FOREIGN KEY ("storyboard_arc_id") REFERENCES "storyboard_arc"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "timeline_event"
  ADD CONSTRAINT "timeline_event_source_scene_id_fkey"
  FOREIGN KEY ("source_scene_id") REFERENCES "scene"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "timeline_event_entity"
  ADD CONSTRAINT "timeline_event_entity_timeline_event_id_fkey"
  FOREIGN KEY ("timeline_event_id") REFERENCES "timeline_event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_event_entity"
  ADD CONSTRAINT "timeline_event_entity_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_timeline_event_project_position" ON "timeline_event"("project_id", "position");
CREATE INDEX "idx_timeline_event_project_impact" ON "timeline_event"("project_id", "impact");
CREATE INDEX "idx_timeline_event_arc" ON "timeline_event"("storyboard_arc_id");
CREATE INDEX "idx_timeline_event_source_scene" ON "timeline_event"("source_scene_id");
CREATE INDEX "idx_timeline_event_entity_entity" ON "timeline_event_entity"("entity_id");
