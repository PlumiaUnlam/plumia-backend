import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toRelationType } from '../domain/relation-type';
import { RelationshipResponseDto } from '../dto/responses/relationship-response.dto';
import { RelationshipProposalResponseDto } from '../dto/responses/relationship-proposal-response.dto';
import type { RelationshipProposalOverrideDto } from '../dto/relationship-proposal-override.dto';

type RelationshipProposalListRecord = Prisma.RelationshipProposalGetPayload<{
  include: {
    sourceEntity: { select: { id: true; canonicalName: true } };
    targetEntity: { select: { id: true; canonicalName: true } };
    sourceEntityProposal: {
      select: { id: true; entityId: true; proposedData: true };
    };
    targetEntityProposal: {
      select: { id: true; entityId: true; proposedData: true };
    };
    relationship: {
      select: {
        relationType: true;
        description: true;
        confidenceScore: true;
      };
    };
  };
}>;

type RelationshipProposalEndpointRecord = {
  id: string;
  canonicalName: string;
} | null;

type EntityProposalEndpointRecord = {
  id: string;
  entityId: string | null;
  proposedData: Prisma.JsonValue;
} | null;

@Injectable()
export class RelationshipProposalService {
  constructor(private readonly prisma: PrismaService) {}

  async listPendingByProject(
    userId: string,
    projectId: string,
  ): Promise<RelationshipProposalResponseDto[]> {
    const proposals = await this.prisma.relationshipProposal.findMany({
      where: {
        projectId,
        status: ProposalStatus.PENDING,
        project: { userId, deletedAt: null },
      },
      include: {
        sourceEntity: { select: { id: true, canonicalName: true } },
        targetEntity: { select: { id: true, canonicalName: true } },
        sourceEntityProposal: {
          select: { id: true, entityId: true, proposedData: true },
        },
        targetEntityProposal: {
          select: { id: true, entityId: true, proposedData: true },
        },
        relationship: {
          select: {
            relationType: true,
            description: true,
            confidenceScore: true,
          },
        },
      },
      orderBy: [{ intensity: 'desc' }, { createdAt: 'desc' }],
    });

    return proposals.map((proposal) => this.toResponse(proposal));
  }

  async acceptProposal(
    userId: string,
    proposalId: string,
    override?: RelationshipProposalOverrideDto,
  ): Promise<RelationshipResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.relationshipProposal.findFirst({
        where: {
          id: proposalId,
          status: ProposalStatus.PENDING,
          project: { userId, deletedAt: null },
        },
        include: {
          sourceEntityProposal: { select: { entityId: true } },
          targetEntityProposal: { select: { entityId: true } },
          relationship: {
            select: {
              description: true,
              relationType: true,
              confidenceScore: true,
            },
          },
        },
      });
      if (!proposal) {
        return null;
      }

      const sourceEntityId =
        override?.sourceEntityId ??
        proposal.sourceEntityId ??
        proposal.sourceEntityProposal?.entityId;
      const targetEntityId =
        override?.targetEntityId ??
        proposal.targetEntityId ??
        proposal.targetEntityProposal?.entityId;
      const relationType = override?.relationType ?? proposal.relationType;
      const description =
        override?.description === undefined
          ? this.mergeDescriptions(
              proposal.relationship?.description ?? null,
              proposal.description,
            )
          : this.mergeDescriptions(
              proposal.relationship?.description ?? null,
              override.description,
            );
      const confidenceScore =
        override?.intensity === undefined
          ? proposal.intensity
          : new Prisma.Decimal(override.intensity / 5);
      if (!sourceEntityId || !targetEntityId) {
        throw new BadRequestException(
          'Las entidades relacionadas deben estar aceptadas antes de aprobar la relacion',
        );
      }
      if (sourceEntityId === targetEntityId) {
        throw new BadRequestException(
          'Una entidad no puede relacionarse consigo misma',
        );
      }

      const entityCount = await tx.entity.count({
        where: {
          id: { in: [sourceEntityId, targetEntityId] },
          projectId: proposal.projectId,
          deletedAt: null,
        },
      });
      if (entityCount !== 2) {
        throw new BadRequestException(
          'Las entidades no pertenecen al proyecto',
        );
      }

      const relationship = proposal.relationshipId
        ? await tx.relationship.update({
            where: { id: proposal.relationshipId },
            data: {
              description,
              relationType,
              confidenceScore,
              sourceEntityId,
              targetEntityId,
            },
          })
        : await tx.relationship.create({
            data: {
              projectId: proposal.projectId,
              sourceEntityId,
              targetEntityId,
              relationType,
              description,
              confidenceScore,
              source: 'ai_proposed',
              validFromSceneId: proposal.sceneId,
            },
          });

      await tx.relationshipProposal.update({
        where: { id: proposal.id },
        data: {
          relationshipId: relationship.id,
          sourceEntityId,
          targetEntityId,
          status: ProposalStatus.APPROVED,
          reviewedById: userId,
          reviewedAt: new Date(),
          resolutionReason: 'accepted_by_author',
        },
      });
      return relationship;
    });

    if (!result) {
      throw new NotFoundException('Relationship proposal not found');
    }
    return RelationshipResponseDto.from({
      id: result.id,
      projectId: result.projectId,
      sourceEntityId: result.sourceEntityId,
      targetEntityId: result.targetEntityId,
      relationType: toRelationType(result.relationType),
      intensity: Math.max(
        1,
        Math.min(5, Math.round(Number(result.confidenceScore) * 5)),
      ),
      description: result.description,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    });
  }

  async rejectProposal(userId: string, proposalId: string): Promise<void> {
    const result = await this.prisma.relationshipProposal.updateMany({
      where: {
        id: proposalId,
        status: ProposalStatus.PENDING,
        project: { userId, deletedAt: null },
      },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedById: userId,
        reviewedAt: new Date(),
        resolutionReason: 'rejected_by_author',
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Relationship proposal not found');
    }
  }

  private toResponse(
    proposal: RelationshipProposalListRecord,
  ): RelationshipProposalResponseDto {
    const source = this.toEndpoint(
      proposal.sourceEntity,
      proposal.sourceEntityProposal,
    );
    const target = this.toEndpoint(
      proposal.targetEntity,
      proposal.targetEntityProposal,
    );
    return {
      id: proposal.id,
      projectId: proposal.projectId,
      sceneId: proposal.sceneId,
      relationshipId: proposal.relationshipId,
      current: proposal.relationship
        ? {
            relationType: toRelationType(proposal.relationship.relationType),
            description: proposal.relationship.description,
            intensity: Number(proposal.relationship.confidenceScore),
          }
        : null,
      source,
      target,
      relationType: toRelationType(proposal.relationType),
      description: proposal.description,
      intensity: Number(proposal.intensity),
      evidence: Array.isArray(proposal.evidence)
        ? proposal.evidence.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : [],
      status: proposal.status,
      canAccept: Boolean(source.id && target.id),
      createdAt: proposal.createdAt,
    };
  }

  private toEndpoint(
    entity: RelationshipProposalEndpointRecord,
    entityProposal: EntityProposalEndpointRecord,
  ): RelationshipProposalResponseDto['source'] {
    const data = entityProposal?.proposedData;
    const proposedName =
      data && typeof data === 'object' && !Array.isArray(data)
        ? data['canonicalName']
        : null;
    return {
      id: entity?.id ?? entityProposal?.entityId ?? null,
      proposalId: entity ? null : (entityProposal?.id ?? null),
      canonicalName:
        entity?.canonicalName ??
        (typeof proposedName === 'string' ? proposedName : 'Entidad'),
      isPending: !entity?.id,
    };
  }

  private mergeDescriptions(
    current: string | null,
    suggested: string | null,
  ): string | null {
    const currentValue = current?.trim();
    const suggestedValue = suggested?.trim();

    if (!suggestedValue) return currentValue ?? null;
    if (!currentValue) return suggestedValue;

    const normalizedCurrent = currentValue.toLowerCase();
    const normalizedSuggested = suggestedValue.toLowerCase();
    if (
      normalizedCurrent.includes(normalizedSuggested) ||
      normalizedSuggested.includes(normalizedCurrent)
    ) {
      return currentValue;
    }

    return `${currentValue}\n\n${suggestedValue}`;
  }
}
