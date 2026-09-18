import type { EntityType } from '../../knowledge/domain/entity-type';
import type { RelationType } from '../../knowledge/domain/relation-type';

export type EntityProposalKind = 'NEW_ENTITY' | 'ENTITY_UPDATE';

export interface SceneChangedOutboxPayload {
  sceneId: string;
  chapterId: string;
  contentHash: string;
  wordCount: number;
  userId: string;
  restoredFromVersionId?: string;
}

export interface ExtractionCandidate {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  confidenceScore: number;
  evidence: string[];
  normalizedName?: string;
}

export interface ChunkEvidence {
  chunkId: string;
  chunkHash: string;
  chunkIndex: number;
}

export interface ExtractionResponse {
  entities: ExtractionCandidate[];
  stateChanges: ExtractedStateChange[];
  relationships: ExtractedRelationship[];
  inconsistencies: ExtractedInconsistency[];
}

export type InconsistencyRuleCode =
  | 'ENTITY_CONTRADICTION'
  | 'DEAD_CHARACTER_ACTION'
  | 'WORLDBUILDING_RULE';

export interface TemporalAuditContext {
  worldRules: unknown;
  entities: Array<{
    canonicalName: string;
    states: Array<{ key: string; value: string }>;
    facts: string[];
  }>;
  relationships: Array<{
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    description: string | null;
  }>;
  deceasedEntityNames: string[];
}

export interface ExtractedInconsistency {
  entityName: string;
  ruleCode: InconsistencyRuleCode;
  field: string;
  currentValue: string;
  observedValue: string;
  explanation: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  evidence: string[];
}

export interface ExtractedRelationship {
  kind: 'CREATE' | 'UPDATE' | 'END';
  sourceEntity: string;
  targetEntity: string;
  relationType: RelationType;
  description: string | null;
  intensity: number;
  evidence: string[];
}

export interface ExtractedStateChange {
  entityName: string;
  attributeKey: string;
  fromValue: string | null;
  toValue: string;
  confidenceScore: number;
  evidence: string[];
}

export interface ConfirmedEntityLike {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes?: Record<string, unknown>;
  userLockedFields?: string[];
}

export interface PendingProposalLike {
  id: string;
  proposedData: unknown;
  confidenceScore: number;
}

export interface ProposalDataLike {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  proposalKind?: EntityProposalKind;
  confidenceScore: number;
  evidence: string[];
  normalizedName: string;
  sourceChunkId?: string | null;
  sourceChunkHash?: string | null;
  chunkEvidence?: ChunkEvidence[];
  source?: string;
}
