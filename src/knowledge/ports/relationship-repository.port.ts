import type { RelationType } from '../domain/relation-type';

export const RELATIONSHIP_REPOSITORY = Symbol('RELATIONSHIP_REPOSITORY');

export interface RelationshipRecord {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  intensity: number;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRelationshipData {
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  intensity: number;
  description?: string;
  validFromSceneId?: string;
}

export interface RelationshipRepository {
  listByProject(
    userId: string,
    projectId: string,
  ): Promise<RelationshipRecord[]>;
  create(
    userId: string,
    data: CreateRelationshipData,
  ): Promise<RelationshipRecord | null>;
}
