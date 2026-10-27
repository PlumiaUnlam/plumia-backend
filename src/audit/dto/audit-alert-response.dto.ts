import type {
  AuditCategory,
  AuditLevel,
  AuditSeverity,
  AuditStatus,
} from '@prisma/client';

export interface EntityConflictDetailsDto {
  entityId: string | null;
  entityName: string;
  field: string;
  currentValue: string;
  observedValue: string;
  evidence: string[];
  supportingEvidence?: Array<{
    side: 'first' | 'second';
    quote: string;
    sceneId?: string;
  }>;
  relationship?: {
    relationshipId: string | null;
    sourceEntityId: string | null;
    sourceEntityName: string;
    targetEntityId: string | null;
    targetEntityName: string;
    relationType: string;
  } | null;
}

export class AuditAlertResponseDto {
  id!: string;
  projectId!: string;
  sceneId!: string;
  detectionLevel!: AuditLevel;
  severity!: AuditSeverity;
  category!: AuditCategory;
  ruleCode!: string | null;
  sourceChunkId!: string | null;
  sourceChunkHash!: string | null;
  title!: string;
  description!: string | null;
  explanation!: string | null;
  confidence!: number;
  status!: AuditStatus;
  createdAt!: Date;
  resolvedAt!: Date | null;
  conflict!: EntityConflictDetailsDto | null;
}
