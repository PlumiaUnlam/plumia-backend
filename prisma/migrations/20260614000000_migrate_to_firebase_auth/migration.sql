-- Migrate user identifiers from UUIDs to Firebase UID strings.

-- Drop foreign keys that depend on "User"."id" before changing the column types.
ALTER TABLE "user_api_key" DROP CONSTRAINT "user_api_key_user_id_fkey";
ALTER TABLE "token_ledger" DROP CONSTRAINT "token_ledger_user_id_fkey";
ALTER TABLE "subscription" DROP CONSTRAINT "subscription_user_id_fkey";
ALTER TABLE "project" DROP CONSTRAINT "project_user_id_fkey";
ALTER TABLE "entity_proposal" DROP CONSTRAINT "entity_proposal_reviewed_by_id_fkey";
ALTER TABLE "audit_alert" DROP CONSTRAINT "audit_alert_resolved_by_id_fkey";
ALTER TABLE "export_job" DROP CONSTRAINT "export_job_user_id_fkey";
ALTER TABLE "writing_session" DROP CONSTRAINT "writing_session_user_id_fkey";
ALTER TABLE "writing_goal" DROP CONSTRAINT "writing_goal_user_id_fkey";

-- Convert the user primary key and every user reference to TEXT.
ALTER TABLE "User" ALTER COLUMN "id" SET DATA TYPE TEXT USING "id"::TEXT;
ALTER TABLE "user_api_key" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "token_ledger" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "subscription" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "project" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "entity_proposal" ALTER COLUMN "reviewed_by_id" SET DATA TYPE TEXT USING "reviewed_by_id"::TEXT;
ALTER TABLE "audit_alert" ALTER COLUMN "resolved_by_id" SET DATA TYPE TEXT USING "resolved_by_id"::TEXT;
ALTER TABLE "export_job" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "writing_session" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;
ALTER TABLE "writing_goal" ALTER COLUMN "user_id" SET DATA TYPE TEXT USING "user_id"::TEXT;

-- Recreate the foreign keys against the TEXT primary key.
ALTER TABLE "user_api_key" ADD CONSTRAINT "user_api_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_proposal" ADD CONSTRAINT "entity_proposal_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_alert" ADD CONSTRAINT "audit_alert_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "writing_session" ADD CONSTRAINT "writing_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "writing_goal" ADD CONSTRAINT "writing_goal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
