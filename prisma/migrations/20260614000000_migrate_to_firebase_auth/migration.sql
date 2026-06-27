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

-- ============================================================
-- SQL especial no modelado por Prisma (editado manualmente)
-- ============================================================

-- Indice GIN trigram para busqueda fuzzy de nombres (idx_entity_name)
CREATE INDEX "idx_entity_name" ON "entity" USING gin ("canonical_name" gin_trgm_ops);

-- Indice IVFFlat para busqueda de similitud de embeddings (idx_chunk_embedding).
-- NOTA: lists=100 dimensiona ~100K chunks (regla pgvector: lists ~= filas/1000).
-- Conviene (re)crear este indice con datos ya cargados; evaluar HNSW como alternativa.
CREATE INDEX "idx_chunk_embedding" ON "chunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- CHECK: ventanas temporales (valid_to distinto de valid_from). La validacion
-- estricta de no-superposicion se delega a la capa de aplicacion.
ALTER TABLE "entity_state" ADD CONSTRAINT "chk_entity_state_window"
  CHECK ("valid_to_scene_id" IS NULL OR "valid_to_scene_id" <> "valid_from_scene_id");
ALTER TABLE "relationship" ADD CONSTRAINT "chk_relationship_window"
  CHECK ("valid_to_scene_id" IS NULL OR "valid_to_scene_id" <> "valid_from_scene_id");

-- CHECK: provider permitido en user_api_key
ALTER TABLE "user_api_key" ADD CONSTRAINT "chk_apikey_provider"
  CHECK ("provider" IN ('deepseek', 'openai', 'fal'));

-- CHECK: role permitido en chat_message
ALTER TABLE "chat_message" ADD CONSTRAINT "chk_message_role"
  CHECK ("role" IN ('user', 'assistant', 'system'));

-- CHECK: scope_type permitido en summary
ALTER TABLE "summary" ADD CONSTRAINT "chk_summary_scope_type"
  CHECK ("scope_type" IN ('scene', 'chapter', 'book', 'arc', 'subplot'));
