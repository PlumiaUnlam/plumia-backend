export class EntityStateProposalResponseDto {
  id!: string;
  projectId!: string;
  sceneId!: string;
  sourceChunkId!: string | null;
  sourceChunkHash!: string | null;
  entityId!: string;
  entityName!: string;
  attributeKey!: string;
  fromValue!: string | null;
  toValue!: string | null;
  evidence!: string[];
  confidenceScore!: number;
  conflictsWithLocked!: boolean;
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'OBSOLETE';
  createdAt!: Date;
}
