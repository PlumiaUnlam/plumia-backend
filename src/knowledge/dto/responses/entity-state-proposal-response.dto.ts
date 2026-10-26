export class EntityStateProposalResponseDto {
  id!: string;
  projectId!: string;
  sceneId!: string;
  sceneTitle!: string | null;
  chapterTitle!: string | null;
  bookTitle!: string | null;
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
  narrativeOrder!: number | null;
  sequenceKind!: 'TRANSITION' | 'CONTRADICTION' | 'UNCERTAIN' | null;
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'OBSOLETE';
  createdAt!: Date;
}
