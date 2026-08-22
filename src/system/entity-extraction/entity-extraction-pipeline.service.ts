/* eslint-disable max-lines */

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditSeverity, Prisma, ProposalStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toEntityType } from '../../knowledge/domain/entity-type';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import type {
  ChunkEvidence,
  ConfirmedEntityLike,
  ExtractionCandidate,
  ExtractedInconsistency,
  ExtractedRelationship,
  PendingProposalLike,
  ProposalDataLike,
  SceneChangedOutboxPayload,
} from './entity-extraction.types';
import { toRelationType } from '../../knowledge/domain/relation-type';

interface JsonNode {
  type?: string;
  text?: string;
  content?: JsonNode[];
}

interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
  contentHash: string | null;
  isDirty: boolean;
}

type ProposalRecord = PendingProposalLike & {
  entityId: string | null;
  sceneId: string;
  status: ProposalStatus;
  sourceChunkId: string | null;
  sourceChunkHash: string | null;
  proposedData: ProposalDataLike;
};

interface RelationshipProposalRecord {
  id: string;
  relationshipId: string | null;
  sourceEntityId: string | null;
  targetEntityId: string | null;
  sourceEntityProposalId: string | null;
  targetEntityProposalId: string | null;
  relationType: string;
  description: string | null;
  intensity: number;
  evidence: string[];
  status: ProposalStatus;
}

interface ProposalRow {
  id: string;
  sceneId: string;
  entityId: string | null;
  proposedData: unknown;
  confidenceScore: Prisma.Decimal | number;
  status: ProposalStatus;
  sourceChunkId?: string | null;
  sourceChunkHash?: string | null;
}

const confirmedEntitySelect = {
  id: true,
  canonicalName: true,
  aliases: true,
  type: true,
  description: true,
  attributes: true,
} satisfies Prisma.EntitySelect;

const proposalSelect = {
  id: true,
  sceneId: true,
  entityId: true,
  proposedData: true,
  confidenceScore: true,
  status: true,
  sourceChunkId: true,
  sourceChunkHash: true,
} satisfies Prisma.EntityProposalSelect;

const relationshipProposalSelect = {
  id: true,
  relationshipId: true,
  sourceEntityId: true,
  targetEntityId: true,
  sourceEntityProposalId: true,
  targetEntityProposalId: true,
  relationType: true,
  description: true,
  intensity: true,
  evidence: true,
  status: true,
} satisfies Prisma.RelationshipProposalSelect;

@Injectable()
export class EntityExtractionPipelineService {
  private readonly logger = new Logger(EntityExtractionPipelineService.name);
  private embeddingWarningShown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly resolution: EntityResolutionService,
    private readonly auditService: AuditService,
  ) {}

  async processOutboxEvent(outboxId: string): Promise<void> {
    const outbox = await this.prisma.outbox.findFirst({
      where: { id: outboxId, processedAt: null },
    });

    if (!outbox) {
      return;
    }

    if (
      outbox.aggregateType !== 'Scene' ||
      outbox.eventType !== 'scene_changed'
    ) {
      await this.markProcessed(outbox.id);
      return;
    }

    const payload = this.parseSceneChangedPayload(outbox.payload);
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
        select: confirmedEntitySelect,
      })
    ).map((entity) => ({
      ...entity,
      type: toEntityType(entity.type),
      attributes: this.normalizeAttributesRecord(entity.attributes),
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
              select: proposalSelect,
            })) as ProposalRow[]
          ).map(
            (proposal) =>
              [
                proposal.id,
                {
                  id: proposal.id,
                  sceneId: proposal.sceneId,
                  entityId: proposal.entityId,
                  proposedData: this.normalizeProposalData(
                    proposal.proposedData,
                  ),
                  confidenceScore: Number(proposal.confidenceScore),
                  status: proposal.status,
                  sourceChunkId: proposal.sourceChunkId ?? null,
                  sourceChunkHash: proposal.sourceChunkHash ?? null,
                },
              ] as const,
          ),
        ),
        new Set<string>(),
        new Map<string, ChunkRow>(),
        scene.id,
      );
      return;
    }

    const chunksById = new Map(
      chunks.map((chunk) => [chunk.id, chunk] as const),
    );
    const activeChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const dirtyChunks = chunks.filter((chunk) => chunk.isDirty);

    const pendingProposals = (await this.prisma.entityProposal.findMany({
      where: {
        projectId,
        status: ProposalStatus.PENDING,
      },
      select: {
        ...proposalSelect,
      },
    })) as ProposalRow[];

    const pendingRelationshipProposals =
      (await this.prisma.relationshipProposal.findMany({
        where: {
          projectId,
          status: ProposalStatus.PENDING,
        },
        select: relationshipProposalSelect,
      })) as unknown as RelationshipProposalRecord[];
    const rejectedRelationshipProposals =
      (await this.prisma.relationshipProposal.findMany({
        where: {
          projectId,
          status: ProposalStatus.REJECTED,
        },
        select: relationshipProposalSelect,
      })) as unknown as RelationshipProposalRecord[];

    const proposalsById = new Map<string, ProposalRecord>(
      pendingProposals.map(
        (proposal) =>
          [
            proposal.id,
            {
              id: proposal.id,
              sceneId: proposal.sceneId,
              entityId: proposal.entityId,
              proposedData: this.normalizeProposalData(proposal.proposedData),
              confidenceScore: Number(proposal.confidenceScore),
              status: proposal.status,
              sourceChunkId: proposal.sourceChunkId ?? null,
              sourceChunkHash: proposal.sourceChunkHash ?? null,
            },
          ] as const,
      ),
    );

    await this.pruneProposalsWithoutActiveSupport(
      proposalsById,
      activeChunkIds,
      chunksById,
      scene.id,
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
          proposalsById,
          relationshipProposals: pendingRelationshipProposals,
          rejectedRelationshipProposals,
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
    proposalsById: Map<string, ProposalRecord>;
    relationshipProposals: RelationshipProposalRecord[];
    rejectedRelationshipProposals: RelationshipProposalRecord[];
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
        description: entity.description,
        attributes: entity.attributes ?? {},
      })),
    });

    await this.processInconsistencyCandidates({
      projectId: input.projectId,
      sceneId: input.scene.id,
      chunk: input.chunk,
      inconsistencies: extracted.inconsistencies,
      confirmedEntities: input.confirmedEntities,
    });

    const candidates = this.resolution.dedupeCandidates(extracted.entities);
    const resolvedEntityReferences = new Map<
      string,
      { entityId: string | null; proposalId: string | null }
    >();
    if (
      !this.extractionClient.hasEmbeddingModel() &&
      !this.embeddingWarningShown
    ) {
      this.logger.warn(
        'ENTITY_EXTRACTION_EMBEDDING_MODEL is not configured; skipping embedding similarity stage',
      );
      this.embeddingWarningShown = true;
    }

    for (const candidate of candidates) {
      const resolution = await this.resolution.resolveCandidate(
        candidate,
        input.confirmedEntities,
        [...input.proposalsById.values()],
        input.compareEmbedding,
      );

      if (resolution.confirmedEntityId) {
        const confirmedEntity = input.confirmedEntities.find(
          (entity) => entity.id === resolution.confirmedEntityId,
        );
        if (!confirmedEntity) {
          continue;
        }

        const proposedUpdate = this.createEntityUpdateProposalData(
          confirmedEntity,
          resolution.candidate,
          input.chunk,
        );
        if (!proposedUpdate) {
          continue;
        }

        const existingProposal = [...input.proposalsById.values()].find(
          (proposal) => proposal.entityId === confirmedEntity.id,
        );
        const updateProposal = existingProposal
          ? await this.updateExistingEntityProposal(
              existingProposal,
              proposedUpdate,
            )
          : await this.createEntityUpdateProposal({
              projectId: input.projectId,
              sceneId: input.scene.id,
              entityId: confirmedEntity.id,
              confidenceScore: resolution.candidate.confidenceScore ?? 0,
              proposedData: proposedUpdate,
            });

        input.proposalsById.set(updateProposal.id, updateProposal);
        this.addResolvedEntityReference(
          resolvedEntityReferences,
          resolution.candidate,
          { entityId: confirmedEntity.id, proposalId: null },
        );
        continue;
      }

      if (resolution.proposalId) {
        const currentProposal = input.proposalsById.get(resolution.proposalId);
        if (!currentProposal) {
          continue;
        }

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
            proposedData: this.toInputJsonValue(mergedData),
            confidenceScore: Math.max(
              Number(currentProposal.confidenceScore),
              resolution.candidate.confidenceScore ?? 0,
            ),
            sourceChunkId: mergedData.sourceChunkId ?? null,
            sourceChunkHash: mergedData.sourceChunkHash ?? null,
          },
          select: proposalSelect,
        })) as ProposalRow;

        input.proposalsById.set(updatedProposal.id, {
          id: updatedProposal.id,
          sceneId: updatedProposal.sceneId,
          entityId: updatedProposal.entityId,
          proposedData: this.normalizeProposalData(
            updatedProposal.proposedData,
          ),
          confidenceScore: Number(updatedProposal.confidenceScore),
          status: updatedProposal.status,
          sourceChunkId: updatedProposal.sourceChunkId ?? null,
          sourceChunkHash: updatedProposal.sourceChunkHash ?? null,
        });
        this.addResolvedEntityReference(
          resolvedEntityReferences,
          resolution.candidate,
          { entityId: null, proposalId: currentProposal.id },
        );
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
            proposedData: this.toInputJsonValue(proposedData),
            confidenceScore: new Prisma.Decimal(
              resolution.candidate.confidenceScore ?? 0,
            ),
          },
          select: proposalSelect,
        })) as ProposalRow;

        input.proposalsById.set(proposal.id, {
          id: proposal.id,
          sceneId: proposal.sceneId,
          entityId: proposal.entityId,
          proposedData: this.normalizeProposalData(proposal.proposedData),
          confidenceScore: Number(proposal.confidenceScore),
          status: proposal.status,
          sourceChunkId: proposal.sourceChunkId ?? null,
          sourceChunkHash: proposal.sourceChunkHash ?? null,
        });
        this.addResolvedEntityReference(
          resolvedEntityReferences,
          resolution.candidate,
          { entityId: null, proposalId: proposal.id },
        );
      }
    }

    await this.processRelationshipCandidates({
      projectId: input.projectId,
      sceneId: input.scene.id,
      chunk: input.chunk,
      relationships: extracted.relationships,
      confirmedEntities: input.confirmedEntities,
      proposals: input.proposalsById,
      resolvedEntityReferences,
      relationshipProposals: input.relationshipProposals,
      rejectedRelationshipProposals: input.rejectedRelationshipProposals,
    });

    await this.clearChunkDirtyFlag(input.chunk.id);
  }

  private async processInconsistencyCandidates(input: {
    projectId: string;
    sceneId: string;
    chunk: ChunkRow;
    inconsistencies: ExtractedInconsistency[];
    confirmedEntities: ConfirmedEntityLike[];
  }): Promise<void> {
    const activeFingerprints = new Set<string>();

    for (const inconsistency of input.inconsistencies ?? []) {
      const entity = this.findConfirmedEntityByName(
        inconsistency.entityName,
        input.confirmedEntities,
      );
      const field = inconsistency.field?.trim();
      const currentValue = inconsistency.currentValue?.trim();
      const observedValue = inconsistency.observedValue?.trim();
      const explanation = inconsistency.explanation?.trim();
      const evidence = [...new Set(inconsistency.evidence ?? [])]
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (
        !entity ||
        !field ||
        !currentValue ||
        !observedValue ||
        !explanation ||
        evidence.length === 0
      ) {
        continue;
      }

      const fingerprint = this.createInconsistencyFingerprint({
        projectId: input.projectId,
        sceneId: input.sceneId,
        chunkHash: input.chunk.contentHash ?? '',
        entityId: entity.id,
        field,
        currentValue,
        observedValue,
      });
      activeFingerprints.add(fingerprint);

      await this.auditService.createEntityContinuityAlert({
        projectId: input.projectId,
        sceneId: input.sceneId,
        sourceChunkId: input.chunk.id,
        sourceChunkHash: input.chunk.contentHash,
        fingerprint,
        entityId: entity.id,
        entityName: entity.canonicalName,
        field,
        currentValue,
        observedValue,
        explanation,
        evidence,
        confidence: this.normalizeConfidence(inconsistency.confidenceScore),
        severity: this.toAuditSeverity(inconsistency.severity),
      });
    }

    await this.auditService.obsoleteContinuityAlertsForChunk({
      sceneId: input.sceneId,
      sourceChunkId: input.chunk.id,
      activeFingerprints,
    });
  }

  private findConfirmedEntityByName(
    name: string,
    entities: ConfirmedEntityLike[],
  ): ConfirmedEntityLike | null {
    const normalizedName = this.resolution.normalize(name ?? '');
    if (!normalizedName) {
      return null;
    }

    return (
      entities.find((entity) =>
        [entity.canonicalName, ...entity.aliases].some(
          (label) => this.resolution.normalize(label) === normalizedName,
        ),
      ) ?? null
    );
  }

  private createInconsistencyFingerprint(input: {
    projectId: string;
    sceneId: string;
    chunkHash: string;
    entityId: string;
    field: string;
    currentValue: string;
    observedValue: string;
  }): string {
    const values = [
      input.projectId,
      input.sceneId,
      input.chunkHash,
      input.entityId,
      input.field,
      input.currentValue,
      input.observedValue,
    ].map((value) => this.resolution.normalize(value));

    return createHash('sha256').update(values.join('|')).digest('hex');
  }

  private normalizeConfidence(value: number): number {
    if (!Number.isFinite(value)) {
      return 0.5;
    }

    return Math.min(1, Math.max(0, value));
  }

  private toAuditSeverity(
    severity: ExtractedInconsistency['severity'],
  ): AuditSeverity {
    if (severity === 'HIGH') {
      return AuditSeverity.HIGH;
    }
    if (severity === 'LOW') {
      return AuditSeverity.LOW;
    }
    return AuditSeverity.MEDIUM;
  }

  private async pruneProposalsWithoutActiveSupport(
    proposalsById: Map<string, ProposalRecord>,
    activeChunkIds: Set<string>,
    chunksById: Map<string, ChunkRow>,
    sceneId: string,
  ): Promise<void> {
    for (const proposal of proposalsById.values()) {
      if (proposal.sceneId !== sceneId) {
        continue;
      }
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
            proposedData: this.toInputJsonValue(nextData),
            sourceChunkId: nextData.sourceChunkId ?? null,
            sourceChunkHash: nextData.sourceChunkHash ?? null,
          },
          select: proposalSelect,
        })) as ProposalRow;

        proposalsById.set(updated.id, {
          id: updated.id,
          sceneId: updated.sceneId,
          entityId: updated.entityId,
          proposedData: this.normalizeProposalData(updated.proposedData),
          confidenceScore: Number(updated.confidenceScore),
          status: updated.status,
          sourceChunkId: updated.sourceChunkId ?? null,
          sourceChunkHash: updated.sourceChunkHash ?? null,
        });
      }
    }
  }

  private addResolvedEntityReference(
    references: Map<
      string,
      { entityId: string | null; proposalId: string | null }
    >,
    candidate: ExtractionCandidate,
    reference: { entityId: string | null; proposalId: string | null },
  ): void {
    for (const label of [
      candidate.canonicalName,
      ...(candidate.aliases ?? []),
    ]) {
      const normalized = this.resolution.normalize(label);
      if (normalized) {
        references.set(normalized, reference);
      }
    }
  }

  private async processRelationshipCandidates(input: {
    projectId: string;
    sceneId: string;
    chunk: ChunkRow;
    relationships: ExtractedRelationship[];
    confirmedEntities: ConfirmedEntityLike[];
    proposals: Map<string, ProposalRecord>;
    resolvedEntityReferences: Map<
      string,
      { entityId: string | null; proposalId: string | null }
    >;
    relationshipProposals: RelationshipProposalRecord[];
    rejectedRelationshipProposals: RelationshipProposalRecord[];
  }): Promise<void> {
    for (const relationship of input.relationships ?? []) {
      const relationType = toRelationType(relationship.relationType);
      const source = this.resolveRelationshipEntity(
        relationship.sourceEntity,
        input,
      );
      const target = this.resolveRelationshipEntity(
        relationship.targetEntity,
        input,
      );

      if (!source || !target || this.sameEntityReference(source, target)) {
        continue;
      }

      const existingRelationship =
        source.entityId && target.entityId
          ? await this.prisma.relationship.findFirst({
              where: {
                projectId: input.projectId,
                sourceEntityId: source.entityId,
                targetEntityId: target.entityId,
                relationType,
              },
              select: { id: true, description: true, confidenceScore: true },
            })
          : null;
      const intensity = this.normalizeRelationshipIntensity(
        relationship.intensity,
      );

      if (
        existingRelationship &&
        !this.relationshipHasNewInformation(
          existingRelationship,
          relationship.description,
          intensity,
        )
      ) {
        continue;
      }

      const current = input.relationshipProposals.find((proposal) =>
        this.matchesRelationshipProposal(
          proposal,
          existingRelationship?.id ?? null,
          source,
          target,
          relationType,
        ),
      );
      const evidence = [...new Set(relationship.evidence ?? [])];

      const wasRejectedWithSameEvidence =
        input.rejectedRelationshipProposals.some(
          (proposal) =>
            this.matchesRelationshipProposal(
              proposal,
              existingRelationship?.id ?? null,
              source,
              target,
              relationType,
            ) && this.hasSharedEvidence(proposal.evidence, evidence),
        );
      if (wasRejectedWithSameEvidence) {
        continue;
      }

      if (current) {
        const updated = await this.prisma.relationshipProposal.update({
          where: { id: current.id },
          data: {
            description: this.mergeRelationshipDescriptions(
              current.description,
              relationship.description,
            ),
            intensity: Math.max(current.intensity, intensity),
            evidence: [...new Set([...current.evidence, ...evidence])],
            sourceChunkId: input.chunk.id,
          },
          select: relationshipProposalSelect,
        });
        Object.assign(current, this.toRelationshipProposalRecord(updated));
        continue;
      }

      const created = await this.prisma.relationshipProposal.create({
        data: {
          projectId: input.projectId,
          sceneId: input.sceneId,
          sourceChunkId: input.chunk.id,
          relationshipId: existingRelationship?.id ?? null,
          sourceEntityId: source.entityId,
          targetEntityId: target.entityId,
          sourceEntityProposalId: source.proposalId,
          targetEntityProposalId: target.proposalId,
          relationType,
          description: relationship.description ?? null,
          intensity,
          evidence,
        },
        select: relationshipProposalSelect,
      });
      input.relationshipProposals.push(
        this.toRelationshipProposalRecord(created),
      );
    }
  }

  private resolveRelationshipEntity(
    label: string,
    input: {
      confirmedEntities: ConfirmedEntityLike[];
      proposals: Map<string, ProposalRecord>;
      resolvedEntityReferences: Map<
        string,
        { entityId: string | null; proposalId: string | null }
      >;
    },
  ): { entityId: string | null; proposalId: string | null } | null {
    const normalized = this.resolution.normalize(label);
    if (!normalized) {
      return null;
    }

    const resolved = input.resolvedEntityReferences.get(normalized);
    if (resolved) {
      return resolved;
    }

    const confirmed = input.confirmedEntities.find((entity) =>
      [entity.canonicalName, ...entity.aliases].some(
        (value) => this.resolution.normalize(value) === normalized,
      ),
    );
    if (confirmed) {
      return { entityId: confirmed.id, proposalId: null };
    }

    for (const proposal of input.proposals.values()) {
      if (
        [
          proposal.proposedData.canonicalName,
          ...proposal.proposedData.aliases,
        ].some((value) => this.resolution.normalize(value) === normalized)
      ) {
        return { entityId: null, proposalId: proposal.id };
      }
    }
    return null;
  }

  private sameEntityReference(
    source: { entityId: string | null; proposalId: string | null },
    target: { entityId: string | null; proposalId: string | null },
  ): boolean {
    return Boolean(
      (source.entityId && source.entityId === target.entityId) ??
      (source.proposalId && source.proposalId === target.proposalId),
    );
  }

  private matchesRelationshipProposal(
    proposal: RelationshipProposalRecord,
    relationshipId: string | null,
    source: { entityId: string | null; proposalId: string | null },
    target: { entityId: string | null; proposalId: string | null },
    relationType: string,
  ): boolean {
    if (proposal.relationType !== relationType) {
      return false;
    }
    if (relationshipId) {
      return proposal.relationshipId === relationshipId;
    }
    return (
      proposal.sourceEntityId === source.entityId &&
      proposal.targetEntityId === target.entityId &&
      proposal.sourceEntityProposalId === source.proposalId &&
      proposal.targetEntityProposalId === target.proposalId
    );
  }

  private relationshipHasNewInformation(
    relationship: {
      description: string | null;
      confidenceScore: Prisma.Decimal;
    },
    description: string | null,
    intensity: number,
  ): boolean {
    const currentDescription = relationship.description?.trim().toLowerCase();
    const incomingDescription = description?.trim().toLowerCase();
    const hasNewDescription = Boolean(
      incomingDescription &&
      (currentDescription === undefined ||
        (!currentDescription.includes(incomingDescription) &&
          !incomingDescription.includes(currentDescription))),
    );
    if (hasNewDescription) {
      return true;
    }
    return Math.abs(Number(relationship.confidenceScore) - intensity) > 0.05;
  }

  private mergeRelationshipDescriptions(
    current: string | null,
    incoming: string | null,
  ): string | null {
    if (!incoming?.trim()) {
      return current;
    }
    if (!current?.trim()) {
      return incoming.trim();
    }
    const normalizedCurrent = current.trim().toLowerCase();
    const normalizedIncoming = incoming.trim().toLowerCase();
    if (
      normalizedCurrent.includes(normalizedIncoming) ||
      normalizedIncoming.includes(normalizedCurrent)
    ) {
      return current.trim();
    }
    return `${current.trim()}\n\n${incoming.trim()}`;
  }

  private hasSharedEvidence(current: string[], incoming: string[]): boolean {
    const currentEvidence = new Set(
      current.map((value) => value.trim().toLowerCase()),
    );
    return incoming.some((value) =>
      currentEvidence.has(value.trim().toLowerCase()),
    );
  }

  private normalizeRelationshipIntensity(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  private toRelationshipProposalRecord(proposal: {
    id: string;
    relationshipId: string | null;
    sourceEntityId: string | null;
    targetEntityId: string | null;
    sourceEntityProposalId: string | null;
    targetEntityProposalId: string | null;
    relationType: string;
    description: string | null;
    intensity: Prisma.Decimal | number;
    evidence: Prisma.JsonValue;
    status: ProposalStatus;
  }): RelationshipProposalRecord {
    return {
      ...proposal,
      intensity: Number(proposal.intensity),
      evidence: Array.isArray(proposal.evidence)
        ? proposal.evidence.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
    };
  }

  private createProposalData(
    candidate: ExtractionCandidate,
    chunk: ChunkRow,
  ): ProposalDataLike {
    const normalizedName =
      candidate.normalizedName ??
      this.resolution.normalize(candidate.canonicalName);

    return {
      canonicalName: candidate.canonicalName,
      aliases: [...new Set(candidate.aliases ?? [])],
      type: candidate.type,
      description: candidate.description,
      attributes: candidate.attributes,
      imageUrl: candidate.imageUrl,
      proposalKind: 'NEW_ENTITY',
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

    const preferredHash = preferredSource
      ? (chunksById.get(preferredSource)?.contentHash ?? null)
      : null;

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
        status: 'OBSOLETE',
        resolutionReason: 'chunk_obsolete',
      },
    });
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
      attributes: data.attributes ?? {},
      imageUrl: data.imageUrl ?? null,
      proposalKind: data.proposalKind ?? 'NEW_ENTITY',
      confidenceScore: data.confidenceScore ?? 0,
      evidence: data.evidence ?? [],
      normalizedName: data.normalizedName ?? '',
      sourceChunkId: data.sourceChunkId ?? null,
      sourceChunkHash: data.sourceChunkHash ?? null,
      chunkEvidence: data.chunkEvidence ?? [],
      source: data.source ?? 'entity_extraction',
    };
  }

  private parseSceneChangedPayload(
    value: Prisma.JsonValue,
  ): SceneChangedOutboxPayload {
    return value as unknown as SceneChangedOutboxPayload;
  }

  private toInputJsonValue(value: ProposalDataLike): Prisma.InputJsonValue {
    return value as unknown as Prisma.InputJsonValue;
  }

  private createEntityUpdateProposalData(
    entity: ConfirmedEntityLike,
    candidate: ExtractionCandidate,
    chunk: ChunkRow,
  ): ProposalDataLike | null {
    const entityLabels = [entity.canonicalName, ...entity.aliases].map(
      (label) => this.resolution.normalize(label),
    );
    const aliases = (candidate.aliases ?? []).filter((alias) => {
      const normalizedAlias = this.resolution.normalize(alias);
      return normalizedAlias && !entityLabels.includes(normalizedAlias);
    });
    const description = this.getSuggestedDescription(
      entity.description,
      candidate.description,
    );
    const attributes = this.getSuggestedAttributes(
      entity.attributes ?? {},
      candidate.attributes,
    );

    if (
      aliases.length === 0 &&
      !description &&
      Object.keys(attributes).length === 0
    ) {
      return null;
    }

    return {
      canonicalName: entity.canonicalName,
      aliases,
      type: entity.type,
      description,
      attributes,
      imageUrl: null,
      proposalKind: 'ENTITY_UPDATE',
      confidenceScore: candidate.confidenceScore,
      evidence: [...new Set(candidate.evidence ?? [])],
      normalizedName: this.resolution.normalize(entity.canonicalName),
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

  private async createEntityUpdateProposal(input: {
    projectId: string;
    sceneId: string;
    entityId: string;
    confidenceScore: number;
    proposedData: ProposalDataLike;
  }): Promise<ProposalRecord> {
    const proposal = (await this.prisma.entityProposal.create({
      data: {
        projectId: input.projectId,
        sceneId: input.sceneId,
        entityId: input.entityId,
        sourceChunkId: input.proposedData.sourceChunkId ?? null,
        sourceChunkHash: input.proposedData.sourceChunkHash ?? null,
        proposedData: this.toInputJsonValue(input.proposedData),
        confidenceScore: new Prisma.Decimal(input.confidenceScore),
      },
      select: proposalSelect,
    })) as ProposalRow;

    return {
      id: proposal.id,
      sceneId: proposal.sceneId,
      entityId: proposal.entityId,
      proposedData: this.normalizeProposalData(proposal.proposedData),
      confidenceScore: Number(proposal.confidenceScore),
      status: proposal.status,
      sourceChunkId: proposal.sourceChunkId ?? null,
      sourceChunkHash: proposal.sourceChunkHash ?? null,
    };
  }

  private async updateExistingEntityProposal(
    proposal: ProposalRecord,
    incoming: ProposalDataLike,
  ): Promise<ProposalRecord> {
    const merged = this.mergeUpdateProposalData(
      proposal.proposedData,
      incoming,
    );
    const updated = (await this.prisma.entityProposal.update({
      where: { id: proposal.id },
      data: {
        proposedData: this.toInputJsonValue(merged),
        confidenceScore: Math.max(
          Number(proposal.confidenceScore),
          incoming.confidenceScore ?? 0,
        ),
        sourceChunkId: merged.sourceChunkId ?? null,
        sourceChunkHash: merged.sourceChunkHash ?? null,
      },
      select: proposalSelect,
    })) as ProposalRow;

    return {
      id: updated.id,
      sceneId: updated.sceneId,
      entityId: updated.entityId,
      proposedData: this.normalizeProposalData(updated.proposedData),
      confidenceScore: Number(updated.confidenceScore),
      status: updated.status,
      sourceChunkId: updated.sourceChunkId ?? null,
      sourceChunkHash: updated.sourceChunkHash ?? null,
    };
  }

  private mergeUpdateProposalData(
    current: ProposalDataLike,
    incoming: ProposalDataLike,
  ): ProposalDataLike {
    const chunkEvidence = new Map<string, ChunkEvidence>();
    for (const entry of [
      ...(current.chunkEvidence ?? []),
      ...(incoming.chunkEvidence ?? []),
    ]) {
      chunkEvidence.set(entry.chunkId, entry);
    }

    return {
      ...current,
      aliases: [
        ...new Set([...(current.aliases ?? []), ...(incoming.aliases ?? [])]),
      ],
      description: this.combineDescriptions(
        current.description,
        incoming.description,
      ),
      attributes: {
        ...(current.attributes ?? {}),
        ...(incoming.attributes ?? {}),
      },
      confidenceScore: Math.max(
        current.confidenceScore ?? 0,
        incoming.confidenceScore ?? 0,
      ),
      evidence: [
        ...new Set([...(current.evidence ?? []), ...(incoming.evidence ?? [])]),
      ],
      chunkEvidence: [...chunkEvidence.values()],
      sourceChunkId: current.sourceChunkId ?? incoming.sourceChunkId ?? null,
      sourceChunkHash:
        current.sourceChunkHash ?? incoming.sourceChunkHash ?? null,
    };
  }

  private getSuggestedDescription(
    current: string | null,
    incoming: string | null,
  ): string | null {
    if (!incoming?.trim()) {
      return null;
    }
    if (!current?.trim()) {
      return incoming.trim();
    }

    const currentValue = current.trim().toLowerCase();
    const incomingValue = incoming.trim().toLowerCase();
    if (
      currentValue.includes(incomingValue) ||
      incomingValue.includes(currentValue)
    ) {
      return null;
    }

    return incoming.trim();
  }

  private combineDescriptions(
    current: string | null,
    incoming: string | null,
  ): string | null {
    if (!incoming?.trim()) {
      return current;
    }
    if (!current?.trim()) {
      return incoming.trim();
    }

    const currentValue = current.trim();
    const incomingValue = incoming.trim();
    const normalizedCurrent = currentValue.toLowerCase();
    const normalizedIncoming = incomingValue.toLowerCase();
    if (
      normalizedCurrent.includes(normalizedIncoming) ||
      normalizedIncoming.includes(normalizedCurrent)
    ) {
      return currentValue;
    }

    return `${currentValue}\n\n${incomingValue}`;
  }

  private getSuggestedAttributes(
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (
        !(key in current) ||
        JSON.stringify(current[key]) !== JSON.stringify(value)
      ) {
        result[key] = value;
      }
    }
    return result;
  }

  private normalizeAttributesRecord(
    value: Prisma.JsonValue | Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
    return {};
  }

  private getEmbeddingComparer(): (text: string) => Promise<number[] | null> {
    if (!this.extractionClient.hasEmbeddingModel()) {
      return () => Promise.resolve(null);
    }

    return async (text: string) => {
      if (!text.trim()) {
        return null;
      }

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

  private extractPlainText(
    node: JsonNode | JsonNode[] | null | undefined,
  ): string {
    if (!node) {
      return '';
    }
    if (Array.isArray(node)) {
      return node.map((child) => this.extractPlainText(child)).join(' ');
    }

    if (node.type === 'text') {
      return node.text ?? '';
    }

    if (!Array.isArray(node.content)) {
      return '';
    }
    return node.content.map((child) => this.extractPlainText(child)).join(' ');
  }
}
