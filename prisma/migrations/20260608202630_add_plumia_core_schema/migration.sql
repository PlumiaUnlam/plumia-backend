-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AUTHOR', 'READER');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CHAT', 'AUDIT', 'EMBEDDING', 'ENTITY_EXTRACTION', 'SUMMARY', 'IMAGE_GENERATION', 'EXPORT');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CHARACTER', 'LOCATION', 'OBJECT', 'ORGANIZATION', 'EVENT', 'CONCEPT');

-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "EpistemicType" AS ENUM ('OBJECTIVE', 'SUBJECTIVE', 'UNRELIABLE', 'SPECULATIVE');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('ALLY', 'ENEMY', 'FAMILY', 'ROMANTIC', 'MENTOR', 'RIVAL', 'MEMBER_OF', 'LOCATED_IN', 'OWNS', 'KNOWS');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditLevel" AS ENUM ('INTRA_SCENE', 'INTER_SCENE', 'GLOBAL');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('CONTINUITY', 'TIMELINE', 'CHARACTER', 'PLOT', 'WORLDBUILDING');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'EPUB', 'DOCX', 'MARKDOWN');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "avatar_url" VARCHAR(500),
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "display_name" VARCHAR(100),
ADD COLUMN     "plan" "PlanType" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'AUTHOR',
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(6),
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "user_api_key" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "key_prefix" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "job_type" "JobType" NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "byok_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan" "PlanType" NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "genre" VARCHAR(100),
    "genre_rules" JSONB,
    "word_count_target" INTEGER,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "sort_key" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "sort_key" VARCHAR(50) NOT NULL,
    "status" "SceneStatus" NOT NULL DEFAULT 'DRAFT',
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "sort_key" VARCHAR(50) NOT NULL,
    "content" JSONB,
    "content_hash" VARCHAR(64),
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "pov_character_id" UUID,
    "status" "SceneStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "canonical_name" VARCHAR(200) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" "EntityType" NOT NULL,
    "description" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "image_url" VARCHAR(500),
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "source" VARCHAR(50) NOT NULL DEFAULT 'author_manual',
    "user_locked_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_state" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "attribute_key" VARCHAR(100) NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "valid_from_scene_id" UUID NOT NULL,
    "valid_to_scene_id" UUID,
    "epistemic_type" "EpistemicType" NOT NULL DEFAULT 'OBJECTIVE',
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "source" VARCHAR(50) NOT NULL DEFAULT 'ai_proposed',
    "narrative_order" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "epistemic_type" "EpistemicType" NOT NULL,
    "source_scene_id" UUID NOT NULL,
    "narrator_id" UUID,
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "is_retconned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_entity_id" UUID NOT NULL,
    "target_entity_id" UUID NOT NULL,
    "relation_type" "RelationType" NOT NULL,
    "description" TEXT,
    "valid_from_scene_id" UUID NOT NULL,
    "valid_to_scene_id" UUID,
    "epistemic_type" "EpistemicType" NOT NULL DEFAULT 'OBJECTIVE',
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "source" VARCHAR(50) NOT NULL DEFAULT 'ai_proposed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_proposal" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "entity_id" UUID,
    "proposed_data" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "resolution_reason" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_alert" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "detection_level" "AuditLevel" NOT NULL,
    "severity" "AuditSeverity" NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "source_conflict" JSONB NOT NULL,
    "explanation" TEXT,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "status" "AuditStatus" NOT NULL DEFAULT 'ACTIVE',
    "anchor_stable_node_id" VARCHAR(100),
    "anchor_text_quote" TEXT,
    "anchor_prefix" TEXT,
    "anchor_suffix" TEXT,
    "anchor_content_hash" VARCHAR(64),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_false_positive" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "offending_text_quote" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "incorrect_pattern" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_false_positive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_thread" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT 'Nueva conversacion',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "anti_spoiler_enabled" BOOLEAN NOT NULL DEFAULT true,
    "current_chapter_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "token_count" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "is_dirty" BOOLEAN NOT NULL DEFAULT false,
    "content_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summary" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_summary_id" UUID,
    "scope_type" VARCHAR(20) NOT NULL,
    "scope_id" UUID NOT NULL,
    "title" VARCHAR(300),
    "content" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'ai_generated',
    "is_dirty" BOOLEAN NOT NULL DEFAULT false,
    "token_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "label" VARCHAR(200),
    "type" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "storage_key" VARCHAR(500) NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "word_count" INTEGER,
    "entity_count" INTEGER,
    "scene_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "scope_type" VARCHAR(20) NOT NULL,
    "scope_id" UUID,
    "template" VARCHAR(50) NOT NULL DEFAULT 'classic',
    "options" JSONB,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "storage_key" VARCHAR(500),
    "file_size_bytes" BIGINT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_image" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "image_type" VARCHAR(20) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storyboard_note" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID,
    "content" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL DEFAULT '#7c4dff',
    "entity_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "note_type" VARCHAR(20) NOT NULL DEFAULT 'text',
    "audio_storage_key" VARCHAR(500),
    "audio_duration_secs" INTEGER,
    "sort_key" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storyboard_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_link" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_id" UUID,
    "slug" CHAR(36) NOT NULL,
    "password_hash" VARCHAR(60),
    "expires_at" TIMESTAMPTZ(6),
    "allow_comments" BOOLEAN NOT NULL DEFAULT true,
    "include_wiki" BOOLEAN NOT NULL DEFAULT false,
    "max_readers" INTEGER,
    "reader_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reader_comment" (
    "id" UUID NOT NULL,
    "share_link_id" UUID NOT NULL,
    "scene_id" UUID,
    "chapter_id" UUID,
    "display_name" VARCHAR(100) NOT NULL,
    "body" TEXT NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reader_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_session" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scene_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_secs" INTEGER,
    "words_added" INTEGER NOT NULL DEFAULT 0,
    "words_deleted" INTEGER NOT NULL DEFAULT 0,
    "words_net" INTEGER NOT NULL DEFAULT 0,
    "keystrokes" INTEGER NOT NULL DEFAULT 0,
    "avg_wpm" DECIMAL(5,1),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_goal" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "goal_type" VARCHAR(20) NOT NULL,
    "target_words" INTEGER NOT NULL,
    "current_words" INTEGER NOT NULL DEFAULT 0,
    "deadline" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "writing_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_apikey_user" ON "user_api_key"("user_id");

-- CreateIndex
CREATE INDEX "idx_apikey_provider" ON "user_api_key"("provider");

-- CreateIndex
CREATE INDEX "idx_ledger_user_date" ON "token_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ledger_project" ON "token_ledger"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_user_id_key" ON "subscription"("user_id");

-- CreateIndex
CREATE INDEX "idx_sub_user" ON "subscription"("user_id");

-- CreateIndex
CREATE INDEX "idx_project_user" ON "project"("user_id");

-- CreateIndex
CREATE INDEX "idx_project_status" ON "project"("status");

-- CreateIndex
CREATE INDEX "idx_book_project" ON "book"("project_id");

-- CreateIndex
CREATE INDEX "idx_book_sort" ON "book"("sort_key");

-- CreateIndex
CREATE UNIQUE INDEX "book_project_id_sort_key_key" ON "book"("project_id", "sort_key");

-- CreateIndex
CREATE INDEX "idx_chapter_book" ON "chapter"("book_id");

-- CreateIndex
CREATE INDEX "idx_chapter_sort" ON "chapter"("sort_key");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_book_id_sort_key_key" ON "chapter"("book_id", "sort_key");

-- CreateIndex
CREATE INDEX "idx_scene_chapter" ON "scene"("chapter_id");

-- CreateIndex
CREATE INDEX "idx_scene_hash" ON "scene"("content_hash");

-- CreateIndex
CREATE INDEX "idx_scene_sort" ON "scene"("sort_key");

-- CreateIndex
CREATE INDEX "idx_scene_pov" ON "scene"("pov_character_id");

-- CreateIndex
CREATE UNIQUE INDEX "scene_chapter_id_sort_key_key" ON "scene"("chapter_id", "sort_key");

-- CreateIndex
CREATE INDEX "idx_entity_project" ON "entity"("project_id");

-- CreateIndex
CREATE INDEX "idx_entity_type" ON "entity"("type");

-- CreateIndex
CREATE INDEX "idx_entity_active" ON "entity"("is_active");

-- CreateIndex
CREATE INDEX "idx_state_entity" ON "entity_state"("entity_id");

-- CreateIndex
CREATE INDEX "idx_state_valid_from" ON "entity_state"("valid_from_scene_id");

-- CreateIndex
CREATE INDEX "idx_state_window" ON "entity_state"("valid_from_scene_id", "valid_to_scene_id");

-- CreateIndex
CREATE INDEX "idx_fact_entity" ON "fact"("entity_id");

-- CreateIndex
CREATE INDEX "idx_fact_scene" ON "fact"("source_scene_id");

-- CreateIndex
CREATE INDEX "idx_fact_epistemic" ON "fact"("epistemic_type");

-- CreateIndex
CREATE INDEX "idx_rel_source" ON "relationship"("source_entity_id");

-- CreateIndex
CREATE INDEX "idx_rel_target" ON "relationship"("target_entity_id");

-- CreateIndex
CREATE INDEX "idx_rel_window" ON "relationship"("valid_from_scene_id", "valid_to_scene_id");

-- CreateIndex
CREATE INDEX "idx_rel_type" ON "relationship"("relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_source_entity_id_target_entity_id_relation_typ_key" ON "relationship"("source_entity_id", "target_entity_id", "relation_type", "valid_from_scene_id");

-- CreateIndex
CREATE INDEX "idx_proposal_project" ON "entity_proposal"("project_id");

-- CreateIndex
CREATE INDEX "idx_proposal_status" ON "entity_proposal"("status");

-- CreateIndex
CREATE INDEX "idx_proposal_entity" ON "entity_proposal"("entity_id");

-- CreateIndex
CREATE INDEX "idx_alert_project" ON "audit_alert"("project_id");

-- CreateIndex
CREATE INDEX "idx_alert_scene" ON "audit_alert"("scene_id");

-- CreateIndex
CREATE INDEX "idx_alert_level" ON "audit_alert"("detection_level");

-- CreateIndex
CREATE INDEX "idx_alert_severity" ON "audit_alert"("severity");

-- CreateIndex
CREATE INDEX "idx_alert_status" ON "audit_alert"("status");

-- CreateIndex
CREATE INDEX "idx_fp_project" ON "audit_false_positive"("project_id");

-- CreateIndex
CREATE INDEX "idx_thread_project" ON "chat_thread"("project_id");

-- CreateIndex
CREATE INDEX "idx_thread_archived" ON "chat_thread"("is_archived");

-- CreateIndex
CREATE INDEX "idx_msg_thread" ON "chat_message"("thread_id");

-- CreateIndex
CREATE INDEX "idx_msg_created" ON "chat_message"("created_at");

-- CreateIndex
CREATE INDEX "idx_chunk_scene" ON "chunk"("scene_id");

-- CreateIndex
CREATE INDEX "idx_chunk_dirty" ON "chunk"("is_dirty");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_scene_id_chunk_index_key" ON "chunk"("scene_id", "chunk_index");

-- CreateIndex
CREATE INDEX "idx_summary_project" ON "summary"("project_id");

-- CreateIndex
CREATE INDEX "idx_summary_scope" ON "summary"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "idx_summary_dirty" ON "summary"("is_dirty");

-- CreateIndex
CREATE INDEX "idx_version_project" ON "version"("project_id");

-- CreateIndex
CREATE INDEX "idx_version_type" ON "version"("type");

-- CreateIndex
CREATE INDEX "idx_export_project" ON "export_job"("project_id");

-- CreateIndex
CREATE INDEX "idx_export_status" ON "export_job"("status");

-- CreateIndex
CREATE INDEX "idx_image_entity" ON "generated_image"("entity_id");

-- CreateIndex
CREATE INDEX "idx_image_primary" ON "generated_image"("is_primary");

-- CreateIndex
CREATE INDEX "idx_note_project" ON "storyboard_note"("project_id");

-- CreateIndex
CREATE INDEX "idx_note_chapter" ON "storyboard_note"("chapter_id");

-- CreateIndex
CREATE INDEX "idx_note_sort" ON "storyboard_note"("sort_key");

-- CreateIndex
CREATE UNIQUE INDEX "share_link_slug_key" ON "share_link"("slug");

-- CreateIndex
CREATE INDEX "idx_share_project" ON "share_link"("project_id");

-- CreateIndex
CREATE INDEX "idx_share_slug" ON "share_link"("slug");

-- CreateIndex
CREATE INDEX "idx_share_expires" ON "share_link"("expires_at");

-- CreateIndex
CREATE INDEX "idx_comment_share" ON "reader_comment"("share_link_id");

-- CreateIndex
CREATE INDEX "idx_comment_visible" ON "reader_comment"("is_visible");

-- CreateIndex
CREATE INDEX "idx_session_user_date" ON "writing_session"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_session_project" ON "writing_session"("project_id");

-- CreateIndex
CREATE INDEX "idx_goal_user" ON "writing_goal"("user_id");

-- CreateIndex
CREATE INDEX "idx_goal_active" ON "writing_goal"("is_active");

-- CreateIndex
CREATE INDEX "idx_outbox_processed" ON "outbox"("processed_at");

-- AddForeignKey
ALTER TABLE "user_api_key" ADD CONSTRAINT "user_api_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book" ADD CONSTRAINT "book_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter" ADD CONSTRAINT "chapter_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_pov_character_id_fkey" FOREIGN KEY ("pov_character_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state" ADD CONSTRAINT "entity_state_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state" ADD CONSTRAINT "entity_state_valid_from_scene_id_fkey" FOREIGN KEY ("valid_from_scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state" ADD CONSTRAINT "entity_state_valid_to_scene_id_fkey" FOREIGN KEY ("valid_to_scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_scene_id_fkey" FOREIGN KEY ("source_scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_narrator_id_fkey" FOREIGN KEY ("narrator_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_valid_from_scene_id_fkey" FOREIGN KEY ("valid_from_scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_valid_to_scene_id_fkey" FOREIGN KEY ("valid_to_scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_proposal" ADD CONSTRAINT "entity_proposal_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_proposal" ADD CONSTRAINT "entity_proposal_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_proposal" ADD CONSTRAINT "entity_proposal_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_proposal" ADD CONSTRAINT "entity_proposal_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_alert" ADD CONSTRAINT "audit_alert_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_alert" ADD CONSTRAINT "audit_alert_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_alert" ADD CONSTRAINT "audit_alert_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_false_positive" ADD CONSTRAINT "audit_false_positive_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_false_positive" ADD CONSTRAINT "audit_false_positive_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "audit_alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_current_chapter_id_fkey" FOREIGN KEY ("current_chapter_id") REFERENCES "chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summary" ADD CONSTRAINT "summary_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summary" ADD CONSTRAINT "summary_parent_summary_id_fkey" FOREIGN KEY ("parent_summary_id") REFERENCES "summary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version" ADD CONSTRAINT "version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_image" ADD CONSTRAINT "generated_image_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_note" ADD CONSTRAINT "storyboard_note_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_note" ADD CONSTRAINT "storyboard_note_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_comment" ADD CONSTRAINT "reader_comment_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_comment" ADD CONSTRAINT "reader_comment_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_comment" ADD CONSTRAINT "reader_comment_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_session" ADD CONSTRAINT "writing_session_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_session" ADD CONSTRAINT "writing_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_session" ADD CONSTRAINT "writing_session_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_goal" ADD CONSTRAINT "writing_goal_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
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
