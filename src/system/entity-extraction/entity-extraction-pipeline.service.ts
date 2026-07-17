import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toEntityType } from '../../knowledge/domain/entity-type';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import type {
  ChunkEvidence,
  ConfirmedEntityLike,
  ExtractionCandidate,
  PendingProposalLike,
  ProposalDataLike,
  SceneChangedOutboxPayload,
} from './entity-extraction.types';

type JsonNode = {
  type?: string;
  text?: string;
  content?: JsonNode[];
};

type ChunkRow = {
  id: string;
  chunkIndex: number;
  content: string;
  contentHash: string | null;
  isDirty: boolean;
};

type ProposalRecord = PendingProposalLike & {
  status: ProposalStatus;
  sourceChunkId: string | null;
  sourceChunkHash: string | null;
  proposedData: ProposalDataLike;
};

type ProposalRow = {
  id: string;
  proposedData: unknown;
  confidenceScore: Prisma.Decimal | number;
  status: ProposalStatus;
  sourceChunkId?: string | null;
  sourceChunkHash?: string | null;
};

@Injectable()
export class EntityExtractionPipelineService {
  private readonly logger = new Logger(EntityExtractionPipelineService.name);
  private embeddingWarningShown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly resolution: EntityResolutionService,
  ) {}

  async processOutboxEvent(outboxId: string): Promise<void> {
    const outbox = await this.prisma.outbox.findFirst({
      where: { id: outboxId, processedAt: null },
    });

    if (!outbox) {
      return;
    }

    if (outbox.aggregateType !== 'Scene' || outbox.eventType !== 'scene_changed') {
      await this.markProcessed(outbox.id);
      return;
    }

    const payload = outbox.payload as SceneChangedOutboxPayload;
    await this.processSceneChanged(payload);
    await this.markProcessed(outbox.id);
  }

  async processSceneChanged(payload: SceneChangedOutboxPayload): Promise<void> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: payload.sceneId,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        content: true,
        chapter: {
          select: {
            id: true,
            title: true,
            book: {
              select: {
                projectId: true,
              },
            },
          },
        },
      },
    });

    if (!scene) {
      return;
    }

    const projectId = scene.chapter.book.projectId;
    const confirmedEntities = (
      await this.prisma.entity.findMany({
      where: {
        projectId,
        deletedAt: null,
      },
      select: {
        id: true,
        canonicalName: true,
        aliases: true,
        type: true,
        description: true,
      },
      } as any)
    ).map((entity) => ({
      ...entity,
      type: toEntityType(entity.type),
    }));

    const chunks = await this.prisma.chunk.findMany({
      where: {
        sceneId: scene.id,
      },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        contentHash: true,
        isDirty: true,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    if (chunks.length === 0) {
      await this.pruneProposalsWithoutActiveSupport(
        new Map(
          (
            (await this.prisma.entityProposal.findMany({
              where: {
                projectId,
                status: ProposalStatus.PENDING,
            },
            select: {
              id: true,
              proposedData: true,
              confidenceScore: true,
              status: true,
              sourceChunkId: true,
              sourceChunkHash: true,
            },
            } as any)) as unknown as ProposalRow[]
          ).map((proposal) => [
            proposal.id,
            {
              id: proposal.id,
              proposedData: this.normalizeProposalData(proposal.proposedData),
              confidenceScore: Number(proposal.confidenceScore),
              status: proposal.status,
              sourceChunkId: proposal.sourceChunkId ?? null,
              sourceChunkHash: proposal.sourceChunkHash ?? null,
            },
          ] as const),
        ),
        new Set<string>(),
        new Map<string, ChunkRow>(),
      );
      return;
    }

    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk] as const));
    const activeChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const dirtyChunks = chunks.filter((chunk) => chunk.isDirty);

    const pendingProposals = (await this.prisma.entityProposal.findMany({
      where: {
        projectId,
        status: ProposalStatus.PENDING,
      },
      select: {
        id: true,
        proposedData: true,
        confidenceScore: true,
        status: true,
        sourceChunkId: true,
        sourceChunkHash: true,
      },
    } as any)) as ProposalRow[];

    const proposalsById = new Map<string, ProposalRecord>(
      pendingProposals.map((proposal) => [
        proposal.id,
        {
          id: proposal.id,
          proposedData: this.normalizeProposalData(proposal.proposedData),
          confidenceScore: Number(proposal.confidenceScore),
          status: proposal.status,
          sourceChunkId: proposal.sourceChunkId ?? null,
          sourceChunkHash: proposal.sourceChunkHash ?? null,
        },
      ] as const),
    );

    await this.pruneProposalsWithoutActiveSupport(
      proposalsById,
      activeChunkIds,
      chunksById,
    );

    const compareEmbedding = this.getEmbeddingComparer();
    const sceneText = this.extractPlainText(scene.content as JsonNode);
    const hasSceneText = sceneText.trim().length > 0;

    if (hasSceneText) {
      for (const chunk of dirtyChunks) {
        await this.processDirtyChunk({
          scene,
          projectId,
          confirmedEntities,
          chunk,
          chunksById,
          activeChunkIds,
          proposalsById,
          compareEmbedding,
        });
      }
    } else {
      for (const chunk of dirtyChunks) {
        await this.clearChunkDirtyFlag(chunk.id);
      }
    }
  }

  private async processDirtyChunk(input: {
    scene: {
      id: string;
      title: string | null;
    };
    projectId: string;
    confirmedEntities: ConfirmedEntityLike[];
    chunk: ChunkRow;
    chunksById: Map<string, ChunkRow>;
    activeChunkIds: Set<string>;
    proposalsById: Map<string, ProposalRecord>;
    compareEmbedding: (text: string) => Promise<number[] | null>;
  }): Promise<void> {
    const chunkText = input.chunk.content.trim();
    if (!chunkText) {
      await this.clearChunkDirtyFlag(input.chunk.id);
      return;
    }

    const extracted = await this.extractionClient.extractEntities({
      sceneText: chunkText,
      knownEntities: input.confirmedEntities.map((entity) => ({
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        type: entity.type,
      })),
    });

    const candidates = this.resolution.dedupeCandidates(extracted);
    const matchedProposalIds = new Set<string>();

    if (!this.extractionClient.hasEmbeddingModel() && !this.embeddingWarningShown) {
      this.logger.warn(
        'ENTITY_EXTRACTION_EMBEDDING_MODEL is not configured; skipping embedding similarity stage',
      );
      this.embeddingWarningShown = true;
    }

    for (const candidate of candidates) {
      const resolution = await this.resolution.resolveCandidate(
        candidate,
        input.confirmedEntities as ConfirmedEntityLike[],
        [...input.proposalsById.values()],
        input.compareEmbedding,
      );

      if (resolution.confirmedEntityId) {
        continue;
      }

      if (resolution.proposalId) {
        const currentProposal = input.proposalsById.get(resolution.proposalId);
        if (!currentProposal) continue;

        const mergedData = this.resolution.mergeProposalData(
          currentProposal.proposedData,
          resolution.candidate,
          {
            chunkId: input.chunk.id,
            chunkHash: input.chunk.contentHash ?? '',
            chunkIndex: input.chunk.chunkIndex,
          },
        );

        const updatedProposal = (await this.prisma.entityProposal.update({
          where: { id: currentProposal.id },
          data: {
            proposedData: mergedData as Prisma.InputJsonValue,
            confidenceScore: Math.max(
              Number(currentProposal.confidenceScore),
              resolution.candidate.confidenceScore ?? 0,
            ),
            sourceChunkId: mergedData.sourceChunkId ?? null,
            sourceChunkHash: mergedData.sourceChunkHash ?? null,
          },
          select: {
            id: true,
            proposedData: true,
            confidenceScore: true,
            status: true,
            sourceChunkId: true,
            sourceChunkHash: true,
          },
        } as any)) as ProposalRow;

        input.proposalsById.set(updatedProposal.id, {
          id: updatedProposal.id,
          proposedData: this.normalizeProposalData(updatedProposal.proposedData),
          confidenceScore: Number(updatedProposal.confidenceScore),
          status: updatedProposal.status,
          sourceChunkId: updatedProposal.sourceChunkId ?? null,
          sourceChunkHash: updatedProposal.sourceChunkHash ?? null,
        });
        matchedProposalIds.add(updatedProposal.id);
        continue;
      }

      if (resolution.shouldCreateProposal) {
        const proposedData = this.createProposalData(
          resolution.candidate,
          input.chunk,
        );

        const proposal = (await this.prisma.entityProposal.create({
          data: {
            projectId: input.projectId,
            sceneId: input.scene.id,
            sourceChunkId: input.chunk.id,
            sourceChunkHash: input.chunk.contentHash,
            proposedData: proposedData as Prisma.InputJsonValue,
            confidenceScore: new Prisma.Decimal(
              resolution.candidate.confidenceScore ?? 0,
            ),
          },
          select: {
            id: true,
            proposedData: true,
            confidenceScore: true,
            status: true,
            sourceChunkId: true,
            sourceChunkHash: true,
          },
        } as any)) as ProposalRow;

        input.proposalsById.set(proposal.id, {
          id: proposal.id,
          proposedData: this.normalizeProposalData(proposal.proposedData),
          confidenceScore: Number(proposal.confidenceScore),
          status: proposal.status,
          sourceChunkId: proposal.sourceChunkId ?? null,
          sourceChunkHash: proposal.sourceChunkHash ?? null,
        });
        matchedProposalIds.add(proposal.id);
      }
    }

    await this.pruneChunkBackedProposalsForChunk({
      chunk: input.chunk,
      activeChunkIds: input.activeChunkIds,
      chunksById: input.chunksById,
      proposalsById: input.proposalsById,
      matchedProposalIds,
    });

    await this.clearChunkDirtyFlag(input.chunk.id);
  }

  private async pruneProposalsWithoutActiveSupport(
    proposalsById: Map<string, ProposalRecord>,
    activeChunkIds: Set<string>,
    chunksById: Map<string, ChunkRow>,
  ): Promise<void> {
    for (const proposal of proposalsById.values()) {
      const currentData = proposal.proposedData;
      const evidence = this.getChunkEvidence(currentData);

      if (evidence.length === 0 && !currentData.sourceChunkId) {
        continue;
      }

      const nextData = this.pruneProposalDataEvidence(
        currentData,
        activeChunkIds,
        chunksById,
      );

      if (!nextData) {
        await this.markProposalObsolete(proposal.id);
        proposalsById.delete(proposal.id);
        continue;
      }

      if (!this.areProposalDataEqual(currentData, nextData)) {
        const updated = (await this.prisma.entityProposal.update({
          where: { id: proposal.id },
          data: {
            proposedData: nextData as Prisma.InputJsonValue,
            sourceChunkId: nextData.sourceChunkId ?? null,
            sourceChunkHash: nextData.sourceChunkHash ?? null,
          },
          select: {
            id: true,
            proposedData: true,
            confidenceScore: true,
            status: true,
            sourceChunkId: true,
            sourceChunkHash: true,
          },
        } as any)) as ProposalRow;

        proposalsById.set(updated.id, {
          id: updated.id,
          proposedData: this.normalizeProposalData(updated.proposedData),
          confidenceScore: Number(updated.confidenceScore),
          status: updated.status,
          sourceChunkId: updated.sourceChunkId ?? null,
          sourceChunkHash: updated.sourceChunkHash ?? null,
        });
      }
    }
  }

  private async pruneChunkBackedProposalsForChunk(input: {
    chunk: ChunkRow;
    activeChunkIds: Set<string>;
    chunksById: Map<string, ChunkRow>;
    proposalsById: Map<string, ProposalRecord>;
    matchedProposalIds: Set<string>;
  }): Promise<void> {
    for (const proposal of input.proposalsById.values()) {
      const evidence = this.getChunkEvidence(proposal.proposedData);
      if (!evidence.some((entry) => entry.chunkId === input.chunk.id)) {
        continue;
      }

      if (input.matchedProposalIds.has(proposal.id)) {
        continue;
      }

      const nextData = this.pruneProposalDataEvidence(
        proposal.proposedData,
        input.activeChunkIds,
        input.chunksById,
        input.chunk.id,
      );

      if (!nextData) {
        await this.markProposalObsolete(proposal.id);
        input.proposalsById.delete(proposal.id);
        continue;
      }

      if (!this.areProposalDataEqual(proposal.proposedData, nextData)) {
        const updated = (await this.prisma.entityProposal.update({
          where: { id: proposal.id },
          data: {
            proposedData: nextData as Prisma.InputJsonValue,
            sourceChunkId: nextData.sourceChunkId ?? null,
            sourceChunkHash: nextData.sourceChunkHash ?? null,
          },
          select: {
            id: true,
            proposedData: true,
            confidenceScore: true,
            status: true,
            sourceChunkId: true,
            sourceChunkHash: true,
          },
        } as any)) as ProposalRow;

        input.proposalsById.set(updated.id, {
          id: updated.id,
          proposedData: this.normalizeProposalData(updated.proposedData),
          confidenceScore: Number(updated.confidenceScore),
          status: updated.status,
          sourceChunkId: updated.sourceChunkId ?? null,
          sourceChunkHash: updated.sourceChunkHash ?? null,
        });
      }
    }
  }

  private createProposalData(
    candidate: ExtractionCandidate,
    chunk: ChunkRow,
  ): ProposalDataLike {
    const normalizedName =
      candidate.normalizedName ?? this.resolution.normalize(candidate.canonicalName);

    return {
      canonicalName: candidate.canonicalName,
      aliases: [...new Set(candidate.aliases ?? [])],
      type: candidate.type as any,
      description: candidate.description,
      attributes: candidate.attributes,
      imageUrl: candidate.imageUrl,
      confidenceScore: candidate.confidenceScore,
      evidence: [...new Set(candidate.evidence ?? [])],
      normalizedName,
      source: 'entity_extraction',
      sourceChunkId: chunk.id,
      sourceChunkHash: chunk.contentHash,
      chunkEvidence: [
        {
          chunkId: chunk.id,
          chunkHash: chunk.contentHash ?? '',
          chunkIndex: chunk.chunkIndex,
        },
      ],
    };
  }

  private pruneProposalDataEvidence(
    data: ProposalDataLike,
    activeChunkIds: Set<string>,
    chunksById: Map<string, ChunkRow>,
    excludedChunkId?: string,
  ): ProposalDataLike | null {
    const evidence = this.getChunkEvidence(data);
    if (evidence.length === 0) {
      return data.sourceChunkId ? null : data;
    }

    const filtered = evidence.filter((entry) => {
      if (excludedChunkId && entry.chunkId === excludedChunkId) {
        return false;
      }
      return activeChunkIds.has(entry.chunkId);
    });

    if (filtered.length === 0) {
      return null;
    }

    const preferredSource =
      data.sourceChunkId &&
      filtered.some((entry) => entry.chunkId === data.sourceChunkId)
        ? data.sourceChunkId
        : filtered[0]!.chunkId;

    const preferredHash =
      preferredSource ? chunksById.get(preferredSource)?.contentHash ?? null : null;

    return {
      ...data,
      chunkEvidence: filtered,
      sourceChunkId: preferredSource,
      sourceChunkHash: preferredHash ?? data.sourceChunkHash ?? null,
    };
  }

  private getChunkEvidence(data: ProposalDataLike): ChunkEvidence[] {
    if (Array.isArray(data.chunkEvidence) && data.chunkEvidence.length > 0) {
      return data.chunkEvidence;
    }

    if (!data.sourceChunkId) {
      return [];
    }

    return [
      {
        chunkId: data.sourceChunkId,
        chunkHash: data.sourceChunkHash ?? '',
        chunkIndex: -1,
      },
    ];
  }

  private async markProposalObsolete(proposalId: string): Promise<void> {
    await this.prisma.entityProposal.update({
      where: { id: proposalId },
      data: {
        status: 'OBSOLETE' as unknown as ProposalStatus,
        resolutionReason: 'chunk_obsolete',
      },
    } as any);
  }

  private areProposalDataEqual(
    current: ProposalDataLike,
    next: ProposalDataLike,
  ): boolean {
    return JSON.stringify(current) === JSON.stringify(next);
  }

  private normalizeProposalData(value: unknown): ProposalDataLike {
    const data = value as Partial<ProposalDataLike>;
    return {
      canonicalName: data.canonicalName ?? '',
      aliases: data.aliases ?? [],
      type: toEntityType(String(data.type ?? 'CONCEPT')),
      description: data.description ?? null,
      attributes: (data.attributes ?? {}) as Record<string, unknown>,
      imageUrl: data.imageUrl ?? null,
      confidenceScore: data.confidenceScore ?? 0,
      evidence: data.evidence ?? [],
      normalizedName: data.normalizedName ?? '',
      sourceChunkId: data.sourceChunkId ?? null,
      sourceChunkHash: data.sourceChunkHash ?? null,
      chunkEvidence: data.chunkEvidence ?? [],
      source: data.source ?? 'entity_extraction',
    };
  }

  private getEmbeddingComparer(): (text: string) => Promise<number[] | null> {
    if (!this.extractionClient.hasEmbeddingModel()) {
      return async () => null;
    }

    return async (text: string) => {
      if (!text.trim()) return null;

      try {
        return await this.extractionClient.createEmbedding(text);
      } catch (error) {
        this.logger.warn(
          `Embedding lookup failed for "${text}": ${(error as Error).message}`,
        );
        return null;
      }
    };
  }

  private async clearChunkDirtyFlag(chunkId: string): Promise<void> {
    await this.prisma.chunk.update({
      where: { id: chunkId },
      data: { isDirty: false },
    });
  }

  private async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id: outboxId },
      data: { processedAt: new Date() },
    });
  }

  private extractPlainText(node: JsonNode | JsonNode[] | null | undefined): string {
    if (!node) return '';
    if (Array.isArray(node)) return node.map((child) => this.extractPlainText(child)).join(' ');

    if (node.type === 'text') {
      return node.text ?? '';
    }

    if (!Array.isArray(node.content)) return '';
    return node.content.map((child) => this.extractPlainText(child)).join(' ');
  }
}
