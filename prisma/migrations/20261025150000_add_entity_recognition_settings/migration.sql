CREATE TABLE "user_entity_recognition_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_entity_recognition_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_entity_recognition_settings_user_id_key"
ON "user_entity_recognition_settings"("user_id");

ALTER TABLE "user_entity_recognition_settings"
ADD CONSTRAINT "user_entity_recognition_settings_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_entity_recognition_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "important_entity_names" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_entity_recognition_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_entity_recognition_settings_project_id_key"
ON "project_entity_recognition_settings"("project_id");

ALTER TABLE "project_entity_recognition_settings"
ADD CONSTRAINT "project_entity_recognition_settings_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
