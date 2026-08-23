-- Preserve audit history while allowing stale AI findings to be hidden.
ALTER TYPE "AuditStatus" ADD VALUE IF NOT EXISTS 'OBSOLETE';

ALTER TABLE "audit_alert"
  ADD COLUMN "fingerprint" VARCHAR(200);

CREATE UNIQUE INDEX "audit_alert_fingerprint_key"
  ON "audit_alert"("fingerprint");
