import { Injectable } from '@nestjs/common';
import { Prisma, type Relationship } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toRelationType } from '../domain/relation-type';
import type {
  CreateRelationshipData,
  RelationshipRecord,
  RelationshipRepository,
  UpdateRelationshipData,
} from '../ports/relationship-repository.port';

@Injectable()
export class PrismaRelationshipRepository implements RelationshipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByProject(
    userId: string,
    projectId: string,
  ): Promise<RelationshipRecord[]> {
    const relationships = await this.prisma.relationship.findMany({
      where: {
        projectId,
        project: { userId, deletedAt: null },
        sourceEntity: { deletedAt: null },
        targetEntity: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
    });

    return relationships.map((relationship) =>
      this.toRelationshipRecord(relationship),
    );
  }

  async create(
    userId: string,
    data: CreateRelationshipData,
  ): Promise<RelationshipRecord | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, userId, deletedAt: null },
      select: { id: true },
    });

    if (!project) {
      return null;
    }

    const entityCount = await this.prisma.entity.count({
      where: {
        id: { in: [data.sourceEntityId, data.targetEntityId] },
        projectId: data.projectId,
        deletedAt: null,
      },
    });

    if (entityCount !== 2) {
      return null;
    }

    const relationship = await this.prisma.relationship.create({
      data: {
        projectId: data.projectId,
        sourceEntityId: data.sourceEntityId,
        targetEntityId: data.targetEntityId,
        relationType: data.relationType,
        description: data.description ?? null,
        confidenceScore: new Prisma.Decimal(data.intensity / 5),
        source: 'author_manual',
        ...(data.validFromSceneId === undefined
          ? {}
          : { validFromSceneId: data.validFromSceneId }),
      },
    });

    return this.toRelationshipRecord(relationship);
  }

  async update(
    userId: string,
    id: string,
    data: UpdateRelationshipData,
  ): Promise<RelationshipRecord | null> {
    const existingRelationship = await this.prisma.relationship.findFirst({
      where: {
        id,
        project: { userId, deletedAt: null },
        sourceEntity: { deletedAt: null },
        targetEntity: { deletedAt: null },
      },
    });

    if (!existingRelationship) {
      return null;
    }

    const sourceEntityId =
      data.sourceEntityId ?? existingRelationship.sourceEntityId;
    const targetEntityId =
      data.targetEntityId ?? existingRelationship.targetEntityId;

    if (sourceEntityId === targetEntityId) {
      return null;
    }

    const entityCount = await this.prisma.entity.count({
      where: {
        id: { in: [sourceEntityId, targetEntityId] },
        projectId: existingRelationship.projectId,
        deletedAt: null,
      },
    });

    if (entityCount !== 2) {
      return null;
    }

    const relationship = await this.prisma.relationship.update({
      where: { id },
      data: {
        ...(data.sourceEntityId === undefined
          ? {}
          : { sourceEntityId: data.sourceEntityId }),
        ...(data.targetEntityId === undefined
          ? {}
          : { targetEntityId: data.targetEntityId }),
        ...(data.relationType === undefined
          ? {}
          : { relationType: data.relationType }),
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
        ...(data.intensity === undefined
          ? {}
          : { confidenceScore: new Prisma.Decimal(data.intensity / 5) }),
      },
    });

    return this.toRelationshipRecord(relationship);
  }

  async delete(userId: string, id: string): Promise<RelationshipRecord | null> {
    const existingRelationship = await this.prisma.relationship.findFirst({
      where: {
        id,
        project: { userId, deletedAt: null },
        sourceEntity: { deletedAt: null },
        targetEntity: { deletedAt: null },
      },
    });

    if (!existingRelationship) {
      return null;
    }

    await this.prisma.relationship.delete({ where: { id } });

    return this.toRelationshipRecord(existingRelationship);
  }

  private toRelationshipRecord(relationship: Relationship): RelationshipRecord {
    return {
      id: relationship.id,
      projectId: relationship.projectId,
      sourceEntityId: relationship.sourceEntityId,
      targetEntityId: relationship.targetEntityId,
      relationType: toRelationType(relationship.relationType),
      intensity: Math.max(
        1,
        Math.min(5, Math.round(Number(relationship.confidenceScore) * 5)),
      ),
      description: relationship.description,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
    };
  }
}
