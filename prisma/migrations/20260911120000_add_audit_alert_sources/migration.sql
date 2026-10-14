ALTER TABLE "audit_alert"
  ADD COLUMN "source_chunk_id" UUID,
  ADD COLUMN "source_chunk_hash" VARCHAR(64),
  ADD COLUMN "rule_code" VARCHAR(100);

CREATE INDEX "idx_alert_chunk_source"
  ON "audit_alert"("scene_id", "source_chunk_id", "source_chunk_hash");

CREATE INDEX "idx_alert_rule"
  ON "audit_alert"("project_id", "scene_id", "rule_code");
