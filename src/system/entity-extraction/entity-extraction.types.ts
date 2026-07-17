import type { EntityType } from '../../knowledge/domain/entity-type';

export type SceneChangedOutboxPayload = {
  sceneId: string;
  chapterId: string;
  contentHash: string;
  wordCount: number;
  userId: string;
  restoredFromVersionId?: string;
};

export type ExtractionCandidate = {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  confidenceScore: number;
  evidence: string[];
  normalizedName?: string;
};

export type ChunkEvidence = {
  chunkId: string;
  chunkHash: string;
  chunkIndex: number;
};

export type ExtractionResponse = {
  entities: ExtractionCandidate[];
};

export type ConfirmedEntityLike = {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
};

export type PendingProposalLike = {
  id: string;
  proposedData: unknown;
  confidenceScore: number;
};

export type ProposalDataLike = {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  confidenceScore: number;
  evidence: string[];
  normalizedName: string;
  sourceChunkId?: string | null;
  sourceChunkHash?: string | null;
  chunkEvidence?: ChunkEvidence[];
  source?: string;
};
