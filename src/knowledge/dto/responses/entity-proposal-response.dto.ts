import type { EntityType } from '../../domain/entity-type';

export interface EntityProposalPayloadDto {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  confidenceScore?: number;
  sourceSceneId?: string;
  sourceSceneTitle?: string | null;
  evidence?: string[];
  normalizedName?: string;
  sourceChunkId?: string | null;
  sourceChunkHash?: string | null;
  chunkEvidence?: Array<{
    chunkId: string;
    chunkHash: string;
    chunkIndex: number;
  }>;
}

export type EntityProposalStatusDto =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'OBSOLETE';

export class EntityProposalResponseDto {
  id!: string;
  projectId!: string;
  sceneId!: string;
  sceneTitle!: string | null;
  chapterTitle!: string | null;
  entityId!: string | null;
  status!: EntityProposalStatusDto;
  confidenceScore!: number;
  resolutionReason!: string | null;
  reviewedById!: string | null;
  reviewedAt!: Date | null;
  createdAt!: Date;
  proposedData!: EntityProposalPayloadDto;

  static from(record: {
    id: string;
    projectId: string;
    sceneId: string;
    sceneTitle: string | null;
    chapterTitle: string | null;
    entityId: string | null;
    status: EntityProposalStatusDto;
    confidenceScore: number;
    resolutionReason: string | null;
    reviewedById: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    proposedData: unknown;
  }): EntityProposalResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      sceneId: record.sceneId,
      sceneTitle: record.sceneTitle,
      chapterTitle: record.chapterTitle,
      entityId: record.entityId,
      status: record.status,
      confidenceScore: record.confidenceScore,
      resolutionReason: record.resolutionReason,
      reviewedById: record.reviewedById,
      reviewedAt: record.reviewedAt,
      createdAt: record.createdAt,
      proposedData: record.proposedData as EntityProposalPayloadDto,
    };
  }
}
