INSERT INTO "user_entity_recognition_settings" ("user_id", "thresholds")
SELECT
  "id",
  '{"CHARACTER":0.55,"LOCATION":0.65,"OBJECT":0.85,"ORGANIZATION":0.70,"EVENT":0.75,"CONCEPT":0.80}'::jsonb
FROM "User";

INSERT INTO "project_entity_recognition_settings" ("project_id", "important_entity_names")
SELECT "id", '[]'::jsonb
FROM "project";
