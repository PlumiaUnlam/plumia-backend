CREATE TABLE "relationship_proposal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "source_chunk_id" UUID,
    "relationship_id" UUID,
    "source_entity_id" UUID,
    "target_entity_id" UUID,
    "source_entity_proposal_id" UUID,
    "target_entity_proposal_id" UUID,
    "relation_type" "RelationType" NOT NULL,
    "description" TEXT,
    "intensity" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "relationship_proposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_relationship_proposal_project_status" ON "relationship_proposal"("project_id", "status");
CREATE INDEX "idx_relationship_proposal_relationship" ON "relationship_proposal"("relationship_id");
CREATE INDEX "idx_relationship_proposal_source_chunk" ON "relationship_proposal"("source_chunk_id");

ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_scene_id_fkey"
  FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_source_chunk_id_fkey"
  FOREIGN KEY ("source_chunk_id") REFERENCES "chunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_relationship_id_fkey"
  FOREIGN KEY ("relationship_id") REFERENCES "relationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_source_entity_id_fkey"
  FOREIGN KEY ("source_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_target_entity_id_fkey"
  FOREIGN KEY ("target_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_source_entity_proposal_id_fkey"
  FOREIGN KEY ("source_entity_proposal_id") REFERENCES "entity_proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_target_entity_proposal_id_fkey"
  FOREIGN KEY ("target_entity_proposal_id") REFERENCES "entity_proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relationship_proposal" ADD CONSTRAINT "relationship_proposal_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
