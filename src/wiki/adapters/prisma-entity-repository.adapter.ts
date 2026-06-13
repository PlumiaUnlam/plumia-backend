import { Injectable } from '@nestjs/common';
import { EntityType, Prisma, type Entity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toPrismaEntityType,
  toWikiEntityType,
} from '../domain/wiki-entity-type';
import {
  CreateEntityData,
  EntityDetailRecord,
  EntityRecord,
  EntityRepository,
  ListEntitiesFilters,
  UpdateEntityData,
} from '../ports/entity-repository.port';

@Injectable()
export class PrismaEntityRepository implements EntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByProjectForUser(
    userId: string,
    projectId: string,
    filters: ListEntitiesFilters,
  ): Promise<EntityRecord[] | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    const entities = await this.prisma.entity.findMany({
      where: this.toEntityWhereInput(projectId, filters),
      orderBy: [{ canonicalName: 'asc' }, { createdAt: 'asc' }],
    });

    return entities.map((entity) => this.toEntityRecord(entity));
  }

  async createForUser(
    userId: string,
    data: CreateEntityData,
  ): Promise<EntityRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    const entity = await this.prisma.entity.create({
      data: {
        projectId: data.projectId,
        canonicalName: data.canonicalName,
        type: toPrismaEntityType(data.type) as EntityType,
        source: 'author_manual',
        confidenceScore: new Prisma.Decimal(1),
        ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.attributes !== undefined
          ? { attributes: data.attributes as Prisma.InputJsonValue }
          : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        userLockedFields: this.lockedFieldsFor(data),
      },
    });

    return this.toEntityRecord(entity);
  }

  async findByIdForUser(
    userId: string,
    entityId: string,
  ): Promise<EntityDetailRecord | null> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      include: {
        facts: true,
        states: true,
        relsAsSource: true,
        relsAsTarget: true,
        generatedImages: true,
      },
    });

    if (!entity) {
      return null;
    }

    return {
      ...this.toEntityRecord(entity),
      facts: entity.facts,
      states: entity.states,
      relationships: [...entity.relsAsSource, ...entity.relsAsTarget],
      generatedImages: entity.generatedImages,
    };
  }

  async updateForUser(
    userId: string,
    entityId: string,
    data: UpdateEntityData,
  ): Promise<EntityRecord | null> {
    const current = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true, userLockedFields: true },
    });

    if (!current) {
      return null;
    }

    await this.prisma.entity.update({
      where: { id: entityId },
      data: {
        ...this.toEntityUpdateData(data),
        userLockedFields: Array.from(
          new Set([...current.userLockedFields, ...this.lockedFieldsFor(data)]),
        ),
      },
    });

    return this.findActiveByIdForUser(userId, entityId);
  }

  async softDeleteForUser(
    userId: string,
    entityId: string,
    deletedAt: Date,
  ): Promise<EntityRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.entity.updateMany({
        where: {
          id: entityId,
          deletedAt: null,
          project: { userId, deletedAt: null },
        },
        data: { deletedAt, isActive: false },
      });

      if (result.count === 0) {
        return null;
      }

      await tx.relationship.deleteMany({
        where: {
          OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }],
        },
      });

      const entity = await tx.entity.findFirst({
        where: { id: entityId, project: { userId } },
      });

      return entity ? this.toEntityRecord(entity) : null;
    });
  }

  private async findActiveByIdForUser(
    userId: string,
    entityId: string,
  ): Promise<EntityRecord | null> {
    const entity = await this.prisma.entity.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
    });

    return entity ? this.toEntityRecord(entity) : null;
  }

  private toEntityWhereInput(
    projectId: string,
    filters: ListEntitiesFilters,
  ): Prisma.EntityWhereInput {
    const search = filters.search?.trim();

    return {
      projectId,
      deletedAt: null,
      isActive: true,
      ...(filters.type !== undefined
        ? { type: toPrismaEntityType(filters.type) as EntityType }
        : {}),
      ...(search
        ? {
            OR: [
              { canonicalName: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { aliases: { has: search } },
            ],
          }
        : {}),
    };
  }

  private toEntityUpdateData(data: UpdateEntityData): Prisma.EntityUpdateInput {
    return {
      ...(data.canonicalName !== undefined
        ? { canonicalName: data.canonicalName }
        : {}),
      ...(data.type !== undefined
        ? { type: toPrismaEntityType(data.type) as EntityType }
        : {}),
      ...(data.aliases !== undefined ? { aliases: data.aliases } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.attributes !== undefined
        ? { attributes: data.attributes as Prisma.InputJsonValue }
        : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
    };
  }

  private lockedFieldsFor(data: UpdateEntityData | CreateEntityData): string[] {
    return Object.entries(data)
      .filter(([field, value]) => field !== 'projectId' && value !== undefined)
      .map(([field]) => field);
  }

  private toEntityRecord(entity: Entity): EntityRecord {
    return {
      id: entity.id,
      projectId: entity.projectId,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      type: toWikiEntityType(entity.type),
      description: entity.description,
      attributes: entity.attributes,
      imageUrl: entity.imageUrl,
      confidenceScore: entity.confidenceScore.toString(),
      source: entity.source,
      userLockedFields: entity.userLockedFields,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }
}
