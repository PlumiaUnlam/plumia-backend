ALTER TABLE "project_entity_recognition_settings"
ADD COLUMN "ignored_entity_names" JSONB NOT NULL DEFAULT '[]'::jsonb;
