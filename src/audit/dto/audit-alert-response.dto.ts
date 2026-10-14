import type {
  AuditCategory,
  AuditLevel,
  AuditSeverity,
  AuditStatus,
} from '@prisma/client';

export interface EntityConflictDetailsDto {
  entityId: string;
  entityName: string;
  field: string;
  currentValue: string;
  observedValue: string;
  evidence: string[];
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
  conflict!: EntityConflictDetailsDto | null;
}
