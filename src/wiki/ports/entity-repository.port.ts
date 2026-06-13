import type { WikiEntityType } from '../domain/wiki-entity-type';

export const ENTITY_REPOSITORY = Symbol('ENTITY_REPOSITORY');

export interface EntityRecord {
  id: string;
  projectId: string;
  canonicalName: string;
  aliases: string[];
  type: WikiEntityType;
  description: string | null;
  attributes: unknown;
  imageUrl: string | null;
  confidenceScore: string;
  source: string;
  userLockedFields: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface EntityDetailRecord extends EntityRecord {
  facts: unknown[];
  states: unknown[];
  relationships: unknown[];
  generatedImages: unknown[];
}

export interface ListEntitiesFilters {
  type?: WikiEntityType;
  search?: string;
}

export interface CreateEntityData {
  projectId: string;
  canonicalName: string;
  type: WikiEntityType;
  aliases?: string[];
  description?: string;
  attributes?: Record<string, unknown>;
  imageUrl?: string;
}

export interface UpdateEntityData {
  canonicalName?: string;
  type?: WikiEntityType;
  aliases?: string[];
  description?: string;
  attributes?: Record<string, unknown>;
  imageUrl?: string;
}

export interface EntityRepository {
  listByProjectForUser(
    userId: string,
    projectId: string,
    filters: ListEntitiesFilters,
  ): Promise<EntityRecord[] | null>;
  createForUser(
    userId: string,
    data: CreateEntityData,
  ): Promise<EntityRecord | null>;
  findByIdForUser(
    userId: string,
    entityId: string,
  ): Promise<EntityDetailRecord | null>;
  updateForUser(
    userId: string,
    entityId: string,
    data: UpdateEntityData,
  ): Promise<EntityRecord | null>;
  softDeleteForUser(
    userId: string,
    entityId: string,
    deletedAt: Date,
  ): Promise<EntityRecord | null>;
}
