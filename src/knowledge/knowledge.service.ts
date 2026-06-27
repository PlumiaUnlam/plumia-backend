import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { ENTITY_SEARCH } from './ports/entity-search.port';
import {
  ENTITY_REPOSITORY,
  type EntityListFilters,
  type EntityRecord,
  type EntityRepository,
} from './ports/entity-repository.port';
import type {
  EntitySearch,
  EntitySearchResult,
} from './ports/entity-search.port';

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(ENTITY_SEARCH) private readonly entitySearch: EntitySearch,
    @Inject(ENTITY_REPOSITORY)
    private readonly entityRepository: EntityRepository,
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

  async createEntity(
    _userId: string,
    projectId: string,
    dto: CreateEntityDto,
  ): Promise<EntityRecord> {
    return this.entityRepository.create({
      projectId,
      canonicalName: dto.canonicalName,
      type: dto.type,
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.aliases !== undefined ? { aliases: dto.aliases } : {}),
      ...(dto.attributes !== undefined ? { attributes: dto.attributes } : {}),
      ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
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
