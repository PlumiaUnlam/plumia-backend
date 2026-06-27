import { Injectable } from '@nestjs/common';
import { Prisma, type Entity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toEntityType } from '../domain/entity-type';
import type {
  CreateEntityData,
  EntityListFilters,
  EntityRecord,
  EntityRepository,
  UpdateEntityData,
} from '../ports/entity-repository.port';

@Injectable()
export class PrismaEntityRepository implements EntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: EntityListFilters): Promise<EntityRecord[]> {
    const where = this.buildWhereClause(filters);
    const entities = await this.prisma.entity.findMany({
      where,
      orderBy: { canonicalName: 'asc' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    });
    return entities.map((entity) => this.toEntityRecord(entity));
  }

  async count(filters: EntityListFilters): Promise<number> {
    const where = this.buildWhereClause(filters);
    return this.prisma.entity.count({ where });
  }

  async findById(id: string): Promise<EntityRecord | null> {
    const entity = await this.prisma.entity.findFirst({
      where: { id, deletedAt: null },
    });
    return entity ? this.toEntityRecord(entity) : null;
  }

  async findByIdForUser(
    userId: string,
    id: string,
  ): Promise<EntityRecord | null> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
    });
    return entity ? this.toEntityRecord(entity) : null;
  }

  async create(data: CreateEntityData): Promise<EntityRecord> {
    const entity = await this.prisma.entity.create({
      data: {
        projectId: data.projectId,
        canonicalName: data.canonicalName,
        type: data.type,
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
        ...(data.aliases === undefined ? {} : { aliases: data.aliases }),
        ...(data.attributes === undefined
          ? {}
          : { attributes: data.attributes as Prisma.InputJsonValue }),
        ...(data.imageUrl === undefined ? {} : { imageUrl: data.imageUrl }),
      },
    });
    return this.toEntityRecord(entity);
  }

  async update(
    userId: string,
    id: string,
    data: UpdateEntityData,
  ): Promise<EntityRecord | null> {
    const result = await this.prisma.entity.updateMany({
      where: {
        id,
        project: { userId, deletedAt: null },
        deletedAt: null,
      },
      data: {
        ...(data.canonicalName === undefined
          ? {}
          : { canonicalName: data.canonicalName }),
        ...(data.type === undefined ? {} : { type: data.type }),
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
        ...(data.aliases === undefined ? {} : { aliases: data.aliases }),
        ...(data.attributes === undefined
          ? {}
          : { attributes: data.attributes as Prisma.InputJsonValue }),
        ...(data.imageUrl === undefined ? {} : { imageUrl: data.imageUrl }),
        ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async softDelete(
    userId: string,
    id: string,
    deletedAt: Date,
  ): Promise<EntityRecord | null> {
    const result = await this.prisma.entity.updateMany({
      where: {
        id,
        project: { userId, deletedAt: null },
        deletedAt: null,
      },
      data: { deletedAt },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  private buildWhereClause(
    filters: EntityListFilters,
  ): Prisma.EntityWhereInput {
    const where: Prisma.EntityWhereInput = {
      projectId: filters.projectId,
      deletedAt: null,
    };

    if (filters.search) {
      where.OR = [
        { canonicalName: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { aliases: { has: filters.search } },
      ];
    }

    if (filters.type) {
      where.type = filters.type;
    }

    return where;
  }

  private toEntityRecord(entity: Entity): EntityRecord {
    return {
      id: entity.id,
      projectId: entity.projectId,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      type: toEntityType(entity.type),
      description: entity.description,
      attributes: entity.attributes,
      imageUrl: entity.imageUrl,
      confidenceScore: Number(entity.confidenceScore),
      source: entity.source,
      userLockedFields: entity.userLockedFields,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }
}
