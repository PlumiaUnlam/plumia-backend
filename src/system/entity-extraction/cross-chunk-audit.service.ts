import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../knowledge/services/temporal-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import type { ExtractedCrossChunkInconsistency } from './entity-extraction.types';

interface AuditChunk {
  id: string;
  chunkIndex: number;
  content: string;
  contentHash: string | null;
}

interface KnownEntity {
  id: string | null;
  canonicalName: string;
  aliases: string[];
  type: string;
  description: string | null;
  attributes: Record<string, unknown>;
}

const entitySelect = {
  id: true,
  canonicalName: true,
  aliases: true,
  type: true,
  description: true,
  attributes: true,
} as const;

/** Audits adjacent chunks without adding extraction proposals. */
@Injectable()
export class CrossChunkAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly resolution: EntityResolutionService,
    private readonly auditService: AuditService,
    private readonly temporalSnapshotService: TemporalKnowledgeSnapshotService,
    private readonly temporalStates: TemporalStateService,
  ) {}

  async auditScene(input: {
    sceneId: string;
    userId: string;
    onlyDirtyChunkIds?: ReadonlySet<string>;
  }): Promise<void> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: input.sceneId, deletedAt: null },
      select: {
        id: true,
        chapter: {
          select: {
            book: {
              select: { projectId: true },
            },
          },
        },
      },
    });
    if (!scene) {
      return;
    }

    const [chunks, entities, pendingEntityProposals, snapshot] =
      await Promise.all([
        this.prisma.chunk.findMany({
          where: { sceneId: input.sceneId },
          select: {
            id: true,
            chunkIndex: true,
            content: true,
            contentHash: true,
          },
          orderBy: { chunkIndex: 'asc' },
        }),
        this.prisma.entity.findMany({
          where: { projectId: scene.chapter.book.projectId, deletedAt: null },
          select: entitySelect,
        }),
        this.prisma.entityProposal.findMany({
          where: {
            projectId: scene.chapter.book.projectId,
            sceneId: input.sceneId,
            status: 'PENDING',
          },
          select: { entityId: true, proposedData: true },
        }),
        this.temporalSnapshotService.getSnapshot(input.sceneId),
      ]);

    const confirmedEntities: KnownEntity[] = entities.map((entity) => ({
      ...entity,
      attributes: this.toAttributes(entity.attributes),
    }));
    const allKnownEntities = [...confirmedEntities];
    for (const proposal of pendingEntityProposals) {
      const candidate = this.toProposedEntity(
        proposal.proposedData,
        proposal.entityId,
      );
      if (
        candidate &&
        !allKnownEntities.some(
          (entity) =>
            this.normalize(entity.canonicalName) ===
            this.normalize(candidate.canonicalName),
        )
      ) {
        allKnownEntities.push(candidate);
      }
    }
    const activeFingerprints = new Set<string>();

    for (let index = 0; index < chunks.length - 1; index += 1) {
      const first = chunks[index] as AuditChunk;
      const second = chunks[index + 1] as AuditChunk;
      if (
        input.onlyDirtyChunkIds &&
        !input.onlyDirtyChunkIds.has(first.id) &&
        !input.onlyDirtyChunkIds.has(second.id)
      ) {
        continue;
      }

      const sharedEntities = this.findSharedEntities(
        first.content,
        second.content,
        allKnownEntities,
      );
      const contradictions = await this.extractionClient.auditAdjacentChunks({
        userId: input.userId,
        firstText: first.content.trim(),
        secondText: second.content.trim(),
        knownEntities: sharedEntities.map((entity) => ({
          canonicalName: entity.canonicalName,
          aliases: entity.aliases,
          type: entity.type,
          description: entity.description,
          attributes: entity.attributes,
        })),
        ...(snapshot
          ? {
              temporalContext: this.temporalSnapshotService.toExtractionContext(
                snapshot,
                `${first.content}\n${second.content}`,
              ),
            }
          : {}),
      });

      for (const contradiction of contradictions) {
        if (contradiction.kind === 'UNCERTAIN') {
          continue;
        }
        if (contradiction.kind === 'TRANSITION') {
          await this.persistTransition({
            userId: input.userId,
            projectId: scene.chapter.book.projectId,
            sceneId: input.sceneId,
            second,
            transition: contradiction,
            knownEntities: sharedEntities,
          });
          continue;
        }
        await this.persistContradiction({
          projectId: scene.chapter.book.projectId,
          sceneId: input.sceneId,
          first,
          second,
          contradiction,
          knownEntities: sharedEntities,
          activeFingerprints,
        });
      }
    }

    if (input.onlyDirtyChunkIds) {
      await this.auditService.obsoleteCrossChunkAlertsForChunks({
        sceneId: input.sceneId,
        sourceChunkIds: input.onlyDirtyChunkIds,
        activeFingerprints,
      });
    } else {
      await this.auditService.obsoleteRuleAlertsForScene({
        sceneId: input.sceneId,
        ruleCodes: ['INTRA_SCENE_CONTRADICTION'],
        activeFingerprints,
      });
    }
  }

  private async persistContradiction(input: {
    projectId: string;
    sceneId: string;
    first: AuditChunk;
    second: AuditChunk;
    contradiction: ExtractedCrossChunkInconsistency;
    knownEntities: readonly KnownEntity[];
    activeFingerprints: Set<string>;
  }): Promise<void> {
    const entity = input.knownEntities.find((candidate) =>
      [candidate.canonicalName, ...candidate.aliases].some(
        (label) =>
          this.resolution.normalize(label) ===
          this.resolution.normalize(input.contradiction.entityName),
      ),
    );
    const field = input.contradiction.field?.trim();
    const firstValue = input.contradiction.firstValue?.trim();
    const secondValue = input.contradiction.secondValue?.trim();
    const explanation = input.contradiction.explanation?.trim();
    const firstEvidence = this.cleanEvidence(input.contradiction.firstEvidence);
    const secondEvidence = this.cleanEvidence(
      input.contradiction.secondEvidence,
    );

    if (
      !field ||
      !firstValue ||
      !secondValue ||
      !explanation ||
      firstEvidence.length === 0 ||
      secondEvidence.length === 0
    ) {
      return;
    }

    const relation = input.contradiction.relationship;
    const source = relation
      ? this.findKnownEntity(relation.sourceEntityName, input.knownEntities)
      : null;
    const target = relation
      ? this.findKnownEntity(relation.targetEntityName, input.knownEntities)
      : null;
    const entityName =
      entity?.canonicalName ?? input.contradiction.entityName.trim();
    if (!entityName) {
      return;
    }
    const fingerprint = this.createFingerprint({
      projectId: input.projectId,
      sceneId: input.sceneId,
      firstChunkHash: input.first.contentHash,
      secondChunkHash: input.second.contentHash,
      entityId: entity?.id ?? this.normalize(entityName),
      field,
      firstValue,
      secondValue,
    });
    input.activeFingerprints.add(fingerprint);
    await this.auditService.createCrossChunkContinuityAlert({
      projectId: input.projectId,
      sceneId: input.sceneId,
      firstChunkId: input.first.id,
      firstChunkHash: input.first.contentHash,
      firstChunkIndex: input.first.chunkIndex,
      secondChunkId: input.second.id,
      secondChunkHash: input.second.contentHash,
      secondChunkIndex: input.second.chunkIndex,
      fingerprint,
      entityId: entity?.id ?? null,
      entityName,
      field,
      firstValue,
      secondValue,
      explanation,
      firstEvidence,
      secondEvidence,
      firstEvidencePositions: this.findEvidencePositions(
        input.first.content,
        firstEvidence,
      ),
      secondEvidencePositions: this.findEvidencePositions(
        input.second.content,
        secondEvidence,
      ),
      confidence: this.normalizeConfidence(input.contradiction.confidenceScore),
      severity: this.toSeverity(input.contradiction.severity),
      ...(relation
        ? {
            relationship: {
              relationshipId: null,
              sourceEntityId: source?.id ?? null,
              sourceEntityName: relation.sourceEntityName,
              targetEntityId: target?.id ?? null,
              targetEntityName: relation.targetEntityName,
              relationType: relation.relationType,
            },
          }
        : {}),
    });
  }

  private async persistTransition(input: {
    userId: string;
    projectId: string;
    sceneId: string;
    second: AuditChunk;
    transition: ExtractedCrossChunkInconsistency;
    knownEntities: readonly KnownEntity[];
  }): Promise<void> {
    const entity = this.findKnownEntity(
      input.transition.entityName,
      input.knownEntities,
    );
    const attributeKey = input.transition.field.trim();
    const evidence = this.cleanEvidence(input.transition.secondEvidence);
    if (!entity?.id || !attributeKey || evidence.length === 0) {
      return;
    }
    await this.temporalStates.createProposal({
      projectId: input.projectId,
      sceneId: input.sceneId,
      sourceChunkId: input.second.id,
      sourceChunkHash: input.second.contentHash,
      entityId: entity.id,
      attributeKey,
      fromValue: input.transition.firstValue,
      toValue: input.transition.secondValue,
      evidence,
      confidenceScore: this.normalizeConfidence(
        input.transition.confidenceScore,
      ),
      narrativeOrder: Math.max(0, input.second.chunkIndex) * 1000,
      sequenceKind: 'TRANSITION',
    });
  }

  private findSharedEntities(
    firstText: string,
    secondText: string,
    entities: readonly KnownEntity[],
  ): KnownEntity[] {
    const first = this.normalize(firstText);
    const second = this.normalize(secondText);
    return entities.filter((entity) =>
      [entity.canonicalName, ...entity.aliases].some((label) => {
        const normalized = this.normalize(label);
        return (
          normalized.length > 1 &&
          first.includes(normalized) &&
          second.includes(normalized)
        );
      }),
    );
  }

  private findKnownEntity(
    name: string,
    entities: readonly KnownEntity[],
  ): KnownEntity | null {
    const normalized = this.normalize(name);
    return (
      entities.find((entity) =>
        [entity.canonicalName, ...entity.aliases].some(
          (label) => this.normalize(label) === normalized,
        ),
      ) ?? null
    );
  }

  private toProposedEntity(
    value: unknown,
    id: string | null,
  ): KnownEntity | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const proposal = value as Record<string, unknown>;
    if (typeof proposal['canonicalName'] !== 'string') {
      return null;
    }
    return {
      id,
      canonicalName: proposal['canonicalName'],
      aliases: Array.isArray(proposal['aliases'])
        ? proposal['aliases'].filter(
            (alias): alias is string => typeof alias === 'string',
          )
        : [],
      type: typeof proposal['type'] === 'string' ? proposal['type'] : 'CONCEPT',
      description:
        typeof proposal['description'] === 'string'
          ? proposal['description']
          : null,
      attributes: this.toAttributes(proposal['attributes']),
    };
  }

  private createFingerprint(input: {
    projectId: string;
    sceneId: string;
    firstChunkHash: string | null;
    secondChunkHash: string | null;
    entityId: string;
    field: string;
    firstValue: string;
    secondValue: string;
  }): string {
    return createHash('sha256')
      .update(
        [
          input.projectId,
          input.sceneId,
          input.firstChunkHash ?? '',
          input.secondChunkHash ?? '',
          input.entityId,
          input.field,
          input.firstValue,
          input.secondValue,
        ]
          .map((value) => this.normalize(value))
          .join('|'),
      )
      .digest('hex');
  }

  private cleanEvidence(value: string[] | undefined): string[] {
    return [
      ...new Set((value ?? []).map((entry) => entry?.trim()).filter(Boolean)),
    ];
  }

  private findEvidencePositions(text: string, evidence: string[]): number[] {
    return evidence.map((quote) => text.indexOf(quote));
  }

  private toSeverity(
    value: ExtractedCrossChunkInconsistency['severity'],
  ): 'HIGH' | 'LOW' | 'MEDIUM' {
    if (value === 'HIGH') {
      return 'HIGH';
    }
    if (value === 'LOW') {
      return 'LOW';
    }
    return 'MEDIUM' as const;
  }

  private normalizeConfidence(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  }

  private toAttributes(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
