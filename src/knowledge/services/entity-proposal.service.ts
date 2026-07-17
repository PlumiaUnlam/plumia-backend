import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProposalStatus, type EntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import { EntityProposalResponseDto } from '../dto/responses/entity-proposal-response.dto';
import type { EntityRecord } from '../ports/entity-repository.port';
import type { AcceptEntityProposalDto } from '../dto/accept-entity-proposal.dto';

type ProposalPayload = {
  canonicalName: string;
  aliases?: string[];
  type: EntityType;
  description?: string | null | undefined;
  attributes?: Record<string, unknown>;
  imageUrl?: string | null | undefined;
  confidenceScore?: number;
  sourceSceneId?: string;
  sourceSceneTitle?: string | null;
  evidence?: string[];
  normalizedName?: string;
};

@Injectable()
export class EntityProposalService {
  constructor(private readonly prisma: PrismaService) {}

  async listPendingByProject(
    userId: string,
    projectId: string,
  ): Promise<EntityProposalResponseDto[]> {
    const proposals = await this.prisma.entityProposal.findMany({
      where: {
        projectId,
        status: ProposalStatus.PENDING,
        project: {
          userId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        projectId: true,
        sceneId: true,
        entityId: true,
        status: true,
        confidenceScore: true,
        resolutionReason: true,
        reviewedById: true,
        reviewedAt: true,
        createdAt: true,
        proposedData: true,
        scene: {
          select: {
            title: true,
            chapter: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: [{ confidenceScore: 'desc' }, { createdAt: 'desc' }],
    });

    return proposals.map((proposal) =>
      EntityProposalResponseDto.from({
        id: proposal.id,
        projectId: proposal.projectId,
        sceneId: proposal.sceneId,
        sceneTitle: proposal.scene.title,
        chapterTitle: proposal.scene.chapter.title,
        entityId: proposal.entityId,
        status: proposal.status,
        confidenceScore: Number(proposal.confidenceScore),
        resolutionReason: proposal.resolutionReason,
        reviewedById: proposal.reviewedById,
        reviewedAt: proposal.reviewedAt,
        createdAt: proposal.createdAt,
        proposedData: proposal.proposedData,
      }),
    );
  }

  async acceptProposal(
    userId: string,
    proposalId: string,
    overrides?: AcceptEntityProposalDto,
  ): Promise<EntityResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.entityProposal.findFirst({
        where: {
          id: proposalId,
          status: ProposalStatus.PENDING,
          project: {
            userId,
            deletedAt: null,
          },
        },
      });

      if (!proposal) {
        return null;
      }

      const proposedData = proposal.proposedData as ProposalPayload;
      const acceptedData = this.mergeProposalPayload(proposedData, overrides);

      const entity =
        proposal.entityId
          ? await tx.entity.findFirst({
              where: {
                id: proposal.entityId,
                project: {
                  userId,
                  deletedAt: null,
                },
                deletedAt: null,
              },
            })
          : null;

      const consolidatedEntity =
        entity ??
        (await tx.entity.create({
          data: {
            projectId: proposal.projectId,
            canonicalName: acceptedData.canonicalName,
            type: acceptedData.type,
            ...(acceptedData.description !== undefined
              ? { description: acceptedData.description }
              : {}),
            aliases: acceptedData.aliases ?? [],
            attributes: (acceptedData.attributes ?? {}) as Prisma.InputJsonValue,
            ...(acceptedData.imageUrl !== undefined
              ? { imageUrl: acceptedData.imageUrl }
              : {}),
            source: 'ai_proposed',
            confidenceScore: proposal.confidenceScore,
          },
        }));

      const acceptedEntity = entity
        ? await tx.entity.update({
            where: { id: entity.id },
            data: this.buildExistingEntityUpdateData(
              entity,
              acceptedData,
              overrides,
            ),
          })
        : consolidatedEntity;

      await tx.entityProposal.update({
        where: { id: proposal.id },
        data: {
          entityId: acceptedEntity.id,
          status: ProposalStatus.APPROVED,
          reviewedById: userId,
          reviewedAt: new Date(),
          resolutionReason: 'accepted_by_author',
        },
      });

      return acceptedEntity;
    });

    if (!result) {
      throw new NotFoundException('Proposal not found');
    }

    return this.toEntityResponse(result);
  }

  async rejectProposal(
    userId: string,
    proposalId: string,
  ): Promise<EntityProposalResponseDto> {
    const proposal = await this.prisma.entityProposal.findFirst({
      where: {
        id: proposalId,
        status: ProposalStatus.PENDING,
        project: {
          userId,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        projectId: true,
        sceneId: true,
        entityId: true,
        status: true,
        confidenceScore: true,
        resolutionReason: true,
        reviewedById: true,
        reviewedAt: true,
        createdAt: true,
        proposedData: true,
        scene: {
          select: {
            title: true,
            chapter: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    const rejectedProposal = await this.prisma.entityProposal.update({
      where: { id: proposal.id },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedById: userId,
        reviewedAt: new Date(),
        resolutionReason: 'rejected_by_author',
      },
      select: {
        id: true,
        projectId: true,
        sceneId: true,
        entityId: true,
        status: true,
        confidenceScore: true,
        resolutionReason: true,
        reviewedById: true,
        reviewedAt: true,
        createdAt: true,
        proposedData: true,
        scene: {
          select: {
            title: true,
            chapter: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    return this.toProposalResponse(rejectedProposal);
  }

  private mergeProposalPayload(
    proposedData: ProposalPayload,
    overrides?: AcceptEntityProposalDto,
  ): ProposalPayload {
    return {
      ...proposedData,
      canonicalName:
        overrides?.canonicalName?.trim() || proposedData.canonicalName,
      type: (overrides?.type ?? proposedData.type) as EntityType,
      description:
        overrides && Object.prototype.hasOwnProperty.call(overrides, 'description')
          ? overrides.description
          : proposedData.description,
      aliases: overrides?.aliases ?? proposedData.aliases ?? [],
      attributes: overrides?.attributes ?? proposedData.attributes ?? {},
      imageUrl:
        overrides && Object.prototype.hasOwnProperty.call(overrides, 'imageUrl')
          ? overrides.imageUrl
          : proposedData.imageUrl,
    };
  }

  private buildExistingEntityUpdateData(
    entity: {
      canonicalName: string;
      aliases: string[];
      type: EntityType;
      description: string | null;
      attributes: Prisma.JsonValue;
      imageUrl: string | null;
    },
    acceptedData: ProposalPayload,
    overrides?: AcceptEntityProposalDto,
  ): Prisma.EntityUpdateInput {
    const data: Prisma.EntityUpdateInput = {
      aliases: [...new Set([...entity.aliases, ...(acceptedData.aliases ?? [])])],
    };

    if (this.hasOverride(overrides, 'canonicalName')) {
      data.canonicalName = acceptedData.canonicalName;
    }

    if (this.hasOverride(overrides, 'type')) {
      data.type = acceptedData.type;
    }

    if (
      this.hasOverride(overrides, 'description') ||
      (!entity.description && acceptedData.description)
    ) {
      data.description = acceptedData.description ?? null;
    }

    if (this.hasOverride(overrides, 'attributes')) {
      data.attributes = (acceptedData.attributes ?? {}) as Prisma.InputJsonValue;
    }

    if (
      this.hasOverride(overrides, 'imageUrl') ||
      (!entity.imageUrl && acceptedData.imageUrl)
    ) {
      data.imageUrl = acceptedData.imageUrl ?? null;
    }

    return data;
  }

  private hasOverride(
    overrides: AcceptEntityProposalDto | undefined,
    key: keyof AcceptEntityProposalDto,
  ): boolean {
    return !!overrides && Object.prototype.hasOwnProperty.call(overrides, key);
  }

  private toEntityResponse(entity: {
    id: string;
    projectId: string;
    canonicalName: string;
    aliases: string[];
    type: EntityType;
    description: string | null;
    attributes: Prisma.JsonValue;
    imageUrl: string | null;
    confidenceScore: Prisma.Decimal | number;
    source: string;
    userLockedFields: Prisma.JsonValue;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): EntityResponseDto {
    return EntityResponseDto.from({
      id: entity.id,
      projectId: entity.projectId,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      type: entity.type as EntityType,
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
    } as EntityRecord);
  }

  private toProposalResponse(proposal: {
    id: string;
    projectId: string;
    sceneId: string;
    entityId: string | null;
    status: ProposalStatus;
    confidenceScore: Prisma.Decimal | number;
    resolutionReason: string | null;
    reviewedById: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    proposedData: unknown;
    scene: {
      title: string | null;
      chapter: {
        title: string | null;
      };
    };
  }): EntityProposalResponseDto {
    return EntityProposalResponseDto.from({
      id: proposal.id,
      projectId: proposal.projectId,
      sceneId: proposal.sceneId,
      sceneTitle: proposal.scene.title,
      chapterTitle: proposal.scene.chapter.title,
      entityId: proposal.entityId,
      status: proposal.status,
      confidenceScore: Number(proposal.confidenceScore),
      resolutionReason: proposal.resolutionReason,
      reviewedById: proposal.reviewedById,
      reviewedAt: proposal.reviewedAt,
      createdAt: proposal.createdAt,
      proposedData: proposal.proposedData,
    });
  }
}
