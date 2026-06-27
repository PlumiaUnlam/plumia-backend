import type { EntityType } from '../domain/entity-type';

export const ENTITY_REPOSITORY = Symbol('ENTITY_REPOSITORY');

export interface EntityRecord {
  id: string;
  projectId: string;
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description: string | null;
  attributes: unknown;
  imageUrl: string | null;
  confidenceScore: number;
  source: string;
  userLockedFields: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateEntityData {
  projectId: string;
  canonicalName: string;
  aliases?: string[];
  type: EntityType;
  description?: string;
  attributes?: Record<string, unknown>;
  imageUrl?: string;
}

export interface UpdateEntityData {
  canonicalName?: string;
  aliases?: string[];
  type?: EntityType;
  description?: string;
  attributes?: Record<string, unknown>;
  imageUrl?: string;
  isActive?: boolean;
}

export interface EntityListFilters {
  projectId: string;
  search?: string;
  type?: EntityType;
  limit?: number;
  offset?: number;
}

export interface EntityRepository {
  list(filters: EntityListFilters): Promise<EntityRecord[]>;
  count(filters: EntityListFilters): Promise<number>;
  findById(id: string): Promise<EntityRecord | null>;
  findByIdForUser(userId: string, id: string): Promise<EntityRecord | null>;
  create(data: CreateEntityData): Promise<EntityRecord>;
  update(
    userId: string,
    id: string,
    data: UpdateEntityData,
  ): Promise<EntityRecord | null>;
  softDelete(
    userId: string,
    id: string,
    deletedAt: Date,
  ): Promise<EntityRecord | null>;
}
