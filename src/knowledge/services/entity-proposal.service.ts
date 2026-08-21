import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProposalStatus, type EntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toEntityType } from '../domain/entity-type';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import { EntityProposalResponseDto } from '../dto/responses/entity-proposal-response.dto';
import type { EntityRecord } from '../ports/entity-repository.port';
import type { EntityProposalKind } from '../../system/entity-extraction/entity-extraction.types';
import type { EntityProposalOverrideDto } from '../dto/entity-proposal-override.dto';

interface ProposalPayload {
  canonicalName: string;
  aliases: string[];
  type: EntityType;
  description?: string | null | undefined;
  attributes: Record<string, unknown>;
  imageUrl?: string | null | undefined;
  proposalKind?: EntityProposalKind | undefined;
  confidenceScore?: number | undefined;
  sourceSceneId?: string | undefined;
  sourceSceneTitle?: string | null | undefined;
  evidence?: string[] | undefined;
  normalizedName?: string | undefined;
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
        entity: {
          select: {
            id: true,
            canonicalName: true,
            aliases: true,
            type: true,
            description: true,
            attributes: true,
          },
        },
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
        targetEntity: proposal.entity
          ? {
              id: proposal.entity.id,
              canonicalName: proposal.entity.canonicalName,
              aliases: proposal.entity.aliases,
              type: toEntityType(proposal.entity.type),
              description: proposal.entity.description,
              attributes: proposal.entity.attributes as Record<string, unknown>,
            }
          : null,
      }),
    );
  }

  async acceptProposal(
    userId: string,
    proposalId: string,
    override?: EntityProposalOverrideDto,
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

      const storedPayload = this.readProposalPayload(proposal.proposedData);
      const mergedPayload = {
        ...storedPayload,
        ...(override ?? {}),
      };

      // Extraction uses null when it has no image suggestion. For an update,
      // that must not clear the image already selected by the author.
      if (
        entity &&
        storedPayload['imageUrl'] === null &&
        !this.hasOwnField(override, 'imageUrl')
      ) {
        delete mergedPayload['imageUrl'];
      }

      const proposedData = this.normalizeProposalPayload(
        mergedPayload,
        entity
          ? {
              canonicalName: entity.canonicalName,
              type: entity.type,
            }
          : undefined,
      );

      const consolidatedEntity = entity
        ? await tx.entity.update({
            where: { id: entity.id },
            data: this.buildAcceptedUpdateEntityData(entity, proposedData),
          })
        : await tx.entity.create({
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
          });

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
      type: toEntityType(result.type),
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

  async rejectProposal(userId: string, proposalId: string): Promise<void> {
    const result = await this.prisma.entityProposal.updateMany({
      where: {
        id: proposalId,
        status: ProposalStatus.PENDING,
        project: {
          userId,
          deletedAt: null,
        },
      },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedById: userId,
        reviewedAt: new Date(),
        resolutionReason: 'rejected_by_author',
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Proposal not found');
    }
  }

  private readProposalPayload(
    value: Prisma.JsonValue,
  ): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  private hasOwnField(value: unknown, key: string): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key)
    );
  }

  private normalizeProposalPayload(
    value: unknown,
    fallback?: Pick<ProposalPayload, 'canonicalName' | 'type'>,
  ): ProposalPayload {
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const rawCanonicalName = raw['canonicalName'];
    const canonicalName =
      typeof rawCanonicalName === 'string' && rawCanonicalName.trim()
        ? rawCanonicalName.trim()
        : (fallback?.canonicalName ?? '');

    if (!canonicalName) {
      throw new BadRequestException(
        'La propuesta de entidad no contiene un nombre válido',
      );
    }

    const rawTypeValue = raw['type'];
    const rawType =
      typeof rawTypeValue === 'string' && rawTypeValue.trim()
        ? rawTypeValue.trim().toUpperCase()
        : (fallback?.type ?? 'CONCEPT');
    const rawAliases = raw['aliases'];
    const aliases = Array.isArray(rawAliases)
      ? [
          ...new Set(
            rawAliases
              .filter((alias): alias is string => typeof alias === 'string')
              .map((alias) => alias.trim())
              .filter(Boolean),
          ),
        ]
      : [];
    const rawDescription = raw['description'];
    const description =
      rawDescription === null
        ? null
        : typeof rawDescription === 'string'
          ? rawDescription
          : undefined;
    const rawAttributes = raw['attributes'];
    const attributes =
      rawAttributes &&
      typeof rawAttributes === 'object' &&
      !Array.isArray(rawAttributes)
        ? (rawAttributes as Record<string, unknown>)
        : {};
    const rawImageUrl = raw['imageUrl'];
    const imageUrl =
      rawImageUrl === null
        ? null
        : typeof rawImageUrl === 'string'
          ? rawImageUrl
          : undefined;

    return {
      canonicalName,
      aliases,
      type: toEntityType(String(rawType)),
      description,
      attributes,
      imageUrl,
      proposalKind:
        typeof raw['proposalKind'] === 'string'
          ? (raw['proposalKind'] as EntityProposalKind)
          : undefined,
      confidenceScore:
        typeof raw['confidenceScore'] === 'number'
          ? raw['confidenceScore']
          : undefined,
      sourceSceneId:
        typeof raw['sourceSceneId'] === 'string'
          ? raw['sourceSceneId']
          : undefined,
      sourceSceneTitle:
        typeof raw['sourceSceneTitle'] === 'string' ||
        raw['sourceSceneTitle'] === null
          ? raw['sourceSceneTitle']
          : undefined,
      evidence: Array.isArray(raw['evidence'])
        ? raw['evidence'].filter(
            (evidence): evidence is string => typeof evidence === 'string',
          )
        : [],
      normalizedName:
        typeof raw['normalizedName'] === 'string'
          ? raw['normalizedName']
          : undefined,
    };
  }

  private buildAcceptedUpdateEntityData(
    entity: {
      canonicalName: string;
      aliases: string[];
      type: EntityType;
      description: string | null;
      attributes: Prisma.JsonValue;
      imageUrl: string | null;
    },
    proposal: ProposalPayload,
  ): Prisma.EntityUpdateInput {
    const mergedAliases = [
      ...new Set([...(entity.aliases ?? []), ...(proposal.aliases ?? [])]),
    ];
    const mergedDescription = this.mergeDescriptions(
      entity.description,
      proposal.description,
    );
    const mergedAttributes = this.mergeAttributes(
      entity.attributes,
      proposal.attributes,
    );

    return {
      ...(proposal.canonicalName === undefined
        ? {}
        : { canonicalName: proposal.canonicalName }),
      ...(proposal.type === undefined ? {} : { type: proposal.type }),
      aliases: mergedAliases,
      ...(mergedDescription === undefined
        ? {}
        : { description: mergedDescription }),
      ...(proposal.imageUrl === undefined
        ? {}
        : { imageUrl: proposal.imageUrl }),
      attributes: mergedAttributes as Prisma.InputJsonValue,
    };
  }

  private mergeDescriptions(
    current: string | null,
    suggested: string | null | undefined,
  ): string | null | undefined {
    const currentValue = current?.trim();
    const suggestedValue = suggested?.trim();

    if (!suggestedValue) {
      return undefined;
    }
    if (!currentValue) {
      return suggestedValue;
    }

    const normalizedCurrent = currentValue.toLowerCase();
    const normalizedSuggested = suggestedValue.toLowerCase();
    if (normalizedCurrent.includes(normalizedSuggested)) {
      return currentValue;
    }
    if (normalizedSuggested.includes(normalizedCurrent)) {
      return suggestedValue;
    }

    return `${currentValue}\n\n${suggestedValue}`;
  }

  private mergeAttributes(
    current: Prisma.JsonValue,
    suggested: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const currentRecord =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return {
      ...currentRecord,
      ...(suggested ?? {}),
    };
  }
}
