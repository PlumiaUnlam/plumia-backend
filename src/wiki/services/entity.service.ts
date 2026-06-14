import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ENTITY_REPOSITORY,
  type CreateEntityData,
  type EntityDetailRecord,
  type EntityRecord,
  type EntityRepository,
  type ListEntitiesFilters,
  type UpdateEntityData,
} from '../ports/entity-repository.port';

@Injectable()
export class EntityService {
  constructor(
    @Inject(ENTITY_REPOSITORY)
    private readonly entityRepository: EntityRepository,
  ) {}

  async list(
    userId: string,
    projectId: string,
    filters: ListEntitiesFilters,
  ): Promise<EntityRecord[]> {
    const entities = await this.entityRepository.listByProjectForUser(
      userId,
      projectId,
      filters,
    );

    if (!entities) {
      throw new NotFoundException('Project not found');
    }

    return entities;
  }

  async create(userId: string, data: CreateEntityData): Promise<EntityRecord> {
    const entity = await this.entityRepository.createForUser(userId, data);

    if (!entity) {
      throw new NotFoundException('Project not found');
    }

    return entity;
  }

  async getById(userId: string, entityId: string): Promise<EntityDetailRecord> {
    const entity = await this.entityRepository.findByIdForUser(
      userId,
      entityId,
    );

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async update(
    userId: string,
    entityId: string,
    data: UpdateEntityData,
  ): Promise<EntityRecord> {
    const entity = await this.entityRepository.updateForUser(
      userId,
      entityId,
      data,
    );

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }

  async remove(userId: string, entityId: string): Promise<EntityRecord> {
    const entity = await this.entityRepository.softDeleteForUser(
      userId,
      entityId,
      new Date(),
    );

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    return entity;
  }
}
