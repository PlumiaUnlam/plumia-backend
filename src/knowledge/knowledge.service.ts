import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import {
  ENTITY_REPOSITORY,
  type EntityListFilters,
  type EntityRecord,
  type EntityRepository,
} from './ports/entity-repository.port';
import {
  RELATIONSHIP_REPOSITORY,
  type RelationshipRecord,
  type RelationshipRepository,
} from './ports/relationship-repository.port';
import type {
  EntitySearch,
  EntitySearchResult,
} from './ports/entity-search.port';
import { CreateRelationshipDto } from './dto/create-relationship.dto';

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(ENTITY_SEARCH) private readonly entitySearch: EntitySearch,
    @Inject(ENTITY_REPOSITORY)
    private readonly entityRepository: EntityRepository,
    @Inject(RELATIONSHIP_REPOSITORY)
    private readonly relationshipRepository: RelationshipRepository,
  ) {}

  searchEntities(
    projectId: string,
    query: string,
    limit = 10,
  ): Promise<EntitySearchResult[]> {
    return this.entitySearch.searchByName({ projectId, query, limit });
  }

  listEntities(filters: EntityListFilters): Promise<EntityRecord[]> {
    return this.entityRepository.list(filters);
  }

  listRelationships(
    userId: string,
    projectId: string,
  ): Promise<RelationshipRecord[]> {
    return this.relationshipRepository.listByProject(userId, projectId);
  }

  async createEntity(
    _userId: string,
    projectId: string,
    dto: CreateEntityDto,
  ): Promise<EntityRecord> {
    return this.entityRepository.create({
      projectId,
      canonicalName: dto.canonicalName,
      type: dto.type,
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.aliases === undefined ? {} : { aliases: dto.aliases }),
      ...(dto.attributes === undefined ? {} : { attributes: dto.attributes }),
      ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }),
    });
  }

  async createRelationship(
    userId: string,
    projectId: string,
    dto: CreateRelationshipDto,
  ): Promise<RelationshipRecord | null> {
    if (dto.sourceEntityId === dto.targetEntityId) {
      throw new BadRequestException('Relationship entities must be different');
    }

    return this.relationshipRepository.create(userId, {
      projectId,
      sourceEntityId: dto.sourceEntityId,
      targetEntityId: dto.targetEntityId,
      relationType: dto.relationType,
      intensity: dto.intensity,
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.validFromSceneId === undefined
        ? {}
        : { validFromSceneId: dto.validFromSceneId }),
    });
  }

  async getEntityById(userId: string, id: string): Promise<EntityRecord> {
    const entity = await this.entityRepository.findByIdForUser(userId, id);

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async updateEntity(
    userId: string,
    id: string,
    dto: UpdateEntityDto,
  ): Promise<EntityRecord> {
    const entity = await this.entityRepository.update(userId, id, dto);

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async removeEntity(userId: string, id: string): Promise<EntityRecord> {
    const entity = await this.entityRepository.softDelete(
      userId,
      id,
      new Date(),
    );

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }
}
