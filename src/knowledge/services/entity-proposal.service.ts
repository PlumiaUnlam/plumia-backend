import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProposalStatus, type EntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import { EntityProposalResponseDto } from '../dto/responses/entity-proposal-response.dto';
import type { EntityRecord } from '../ports/entity-repository.port';

interface ProposalPayload {
  canonicalName: string;
  aliases?: string[];
  type: EntityType;
  description?: string | null;
  attributes?: Record<string, unknown>;
  imageUrl?: string | null;
  confidenceScore?: number;
  sourceSceneId?: string;
  sourceSceneTitle?: string | null;
  evidence?: string[];
  normalizedName?: string;
}

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

      const entity = proposal.entityId
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
            canonicalName: proposedData.canonicalName,
            type: proposedData.type,
            ...(proposedData.description !== undefined
              ? { description: proposedData.description }
              : {}),
            aliases: proposedData.aliases ?? [],
            attributes: (proposedData.attributes ??
              {}) as Prisma.InputJsonValue,
            ...(proposedData.imageUrl !== undefined
              ? { imageUrl: proposedData.imageUrl }
              : {}),
            source: 'ai_proposed',
            confidenceScore: proposal.confidenceScore,
          },
        }));

      await tx.entityProposal.update({
        where: { id: proposal.id },
        data: {
          entityId: consolidatedEntity.id,
          status: ProposalStatus.APPROVED,
          reviewedById: userId,
          reviewedAt: new Date(),
          resolutionReason: 'accepted_by_author',
        },
      });

      return consolidatedEntity;
    });

    if (!result) {
      throw new NotFoundException('Proposal not found');
    }

    const entityRecord: EntityRecord = {
      id: result.id,
      projectId: result.projectId,
      canonicalName: result.canonicalName,
      aliases: result.aliases,
      type: result.type,
      description: result.description,
      attributes: result.attributes,
      imageUrl: result.imageUrl,
      confidenceScore: Number(result.confidenceScore),
      source: result.source,
      userLockedFields: result.userLockedFields,
      isActive: result.isActive,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      deletedAt: result.deletedAt,
    };

    return EntityResponseDto.from(entityRecord);
  }
}
