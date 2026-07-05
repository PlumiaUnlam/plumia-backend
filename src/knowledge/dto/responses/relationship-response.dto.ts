import type { RelationType } from '../../domain/relation-type';
import type { RelationshipRecord } from '../../ports/relationship-repository.port';

export class RelationshipResponseDto {
  id!: string;
  projectId!: string;
  sourceEntityId!: string;
  targetEntityId!: string;
  relationType!: RelationType;
  intensity!: number;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: RelationshipRecord): RelationshipResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      sourceEntityId: record.sourceEntityId,
      targetEntityId: record.targetEntityId,
      relationType: record.relationType,
      intensity: record.intensity,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
