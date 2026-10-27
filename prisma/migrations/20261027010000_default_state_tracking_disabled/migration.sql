-- Keep the existing behavior for projects created before this default changes.
INSERT INTO "project_knowledge_review_settings" (
  "id",
  "project_id",
  "created_at",
  "updated_at",
  "state_tracking_enabled"
)
SELECT
  gen_random_uuid(),
  project."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  true
FROM "project" AS project
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_knowledge_review_settings" AS settings
  WHERE settings."project_id" = project."id"
);

ALTER TABLE "project_knowledge_review_settings"
  ALTER COLUMN "state_tracking_enabled" SET DEFAULT false;
