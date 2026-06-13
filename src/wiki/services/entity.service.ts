import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEntityDto } from '../dto/entities/create-entity.dto';
import { ListEntitiesQueryDto } from '../dto/entities/list-entities-query.dto';
import { UpdateEntityDto } from '../dto/entities/update-entity.dto';
import {
  ENTITY_REPOSITORY,
  type EntityDetailRecord,
  type EntityRecord,
  type EntityRepository,
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
    filters: ListEntitiesQueryDto,
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

  async create(
    userId: string,
    projectId: string,
    dto: CreateEntityDto,
  ): Promise<EntityRecord> {
    const entity = await this.entityRepository.createForUser(userId, {
      projectId,
      canonicalName: dto.canonicalName,
      type: dto.type,
      ...(dto.aliases !== undefined ? { aliases: dto.aliases } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.attributes !== undefined ? { attributes: dto.attributes } : {}),
      ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
    });

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
    dto: UpdateEntityDto,
  ): Promise<EntityRecord> {
    const entity = await this.entityRepository.updateForUser(
      userId,
      entityId,
      dto,
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
