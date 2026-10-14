-- CreateEnum
CREATE TYPE "RelationshipProposalKind" AS ENUM ('CREATE', 'UPDATE', 'END');

-- AlterTable
ALTER TABLE "entity_proposal"
ADD COLUMN "conflicts_with_locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "relationship_proposal"
ADD COLUMN "kind" "RelationshipProposalKind" NOT NULL DEFAULT 'CREATE';

-- AlterTable
ALTER TABLE "relationship_proposal"
ADD COLUMN "source_chunk_hash" VARCHAR(64);

-- CreateTable
CREATE TABLE "entity_state_proposal" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "source_chunk_id" UUID,
    "source_chunk_hash" VARCHAR(64),
    "entity_id" UUID NOT NULL,
    "attribute_key" VARCHAR(100) NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "conflicts_with_locked" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entity_state_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_state_proposal_project_status" ON "entity_state_proposal"("project_id", "status");

-- CreateIndex
CREATE INDEX "idx_state_proposal_entity_status" ON "entity_state_proposal"("entity_id", "status");

-- CreateIndex
CREATE INDEX "idx_state_proposal_source_chunk" ON "entity_state_proposal"("source_chunk_id");

-- AddForeignKey
ALTER TABLE "entity_state_proposal"
ADD CONSTRAINT "entity_state_proposal_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state_proposal"
ADD CONSTRAINT "entity_state_proposal_scene_id_fkey"
FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state_proposal"
ADD CONSTRAINT "entity_state_proposal_source_chunk_id_fkey"
FOREIGN KEY ("source_chunk_id") REFERENCES "chunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state_proposal"
ADD CONSTRAINT "entity_state_proposal_entity_id_fkey"
FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_state_proposal"
ADD CONSTRAINT "entity_state_proposal_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
