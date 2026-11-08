import { type AuditLevel } from '@prisma/client';
import { type AuditService } from '../../audit/audit.service';
import { type TemporalStateService } from '../../knowledge/services/temporal-state.service';
import { type PrismaService } from '../../prisma/prisma.service';
import { type EntityResolutionService } from './entity-resolution.service';
import type { ExtractedCrossChunkInconsistency } from './entity-extraction.types';
import { type AuditChunk, type KnownEntity } from './cross-chunk-audit.types';
import {
  findKnownEntity,
  createFingerprint,
  cleanEvidence,
  findEvidencePositions,
  toSeverity,
  normalizeConfidence,
  normalize,
} from './cross-chunk-audit.helpers';

export class CrossChunkAuditPersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: EntityResolutionService,
    private readonly auditService: AuditService,
    private readonly temporalStates: TemporalStateService,
  ) {}
  async persistContradiction(input: {
    projectId: string;
    sceneId: string;
    first: AuditChunk;
    second: AuditChunk;
    contradiction: ExtractedCrossChunkInconsistency;
    knownEntities: readonly KnownEntity[];
    activeFingerprints: Set<string>;
    ruleCode?: string;
    title?: string;
    detectionLevel?: AuditLevel;
    firstSceneId?: string;
    secondSceneId?: string;
  }): Promise<void> {
    const latestSources = await this.prisma.chunk.findMany({
      where: { id: { in: [input.first.id, input.second.id] } },
      select: { id: true, content: true, contentHash: true },
    });
    const latestById = new Map(
      latestSources.map((source) => [source.id, source] as const),
    );
    const currentFirst = latestById.get(input.first.id);
    const currentSecond = latestById.get(input.second.id);
    if (
      !currentFirst ||
      !currentSecond ||
      currentFirst.contentHash !== input.first.contentHash ||
      currentSecond.contentHash !== input.second.contentHash ||
      currentFirst.content !== input.first.content ||
      currentSecond.content !== input.second.content
    ) {
      return;
    }
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
    const firstEvidence = cleanEvidence(
      input.contradiction.firstEvidence,
    ).filter((quote) => currentFirst.content.includes(quote));
    const secondEvidence = cleanEvidence(
      input.contradiction.secondEvidence,
    ).filter((quote) => currentSecond.content.includes(quote));

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
      ? findKnownEntity(relation.sourceEntityName, input.knownEntities)
      : null;
    const target = relation
      ? findKnownEntity(relation.targetEntityName, input.knownEntities)
      : null;
    const entityName =
      entity?.canonicalName ?? input.contradiction.entityName.trim();
    if (!entityName) {
      return;
    }
    const fingerprint = createFingerprint({
      projectId: input.projectId,
      sceneId: input.sceneId,
      firstChunkHash: input.first.contentHash,
      secondChunkHash: input.second.contentHash,
      entityId: entity?.id ?? normalize(entityName),
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
      ...(input.firstSceneId ? { firstSceneId: input.firstSceneId } : {}),
      secondChunkId: input.second.id,
      secondChunkHash: input.second.contentHash,
      secondChunkIndex: input.second.chunkIndex,
      ...(input.secondSceneId ? { secondSceneId: input.secondSceneId } : {}),
      fingerprint,
      entityId: entity?.id ?? null,
      entityName,
      field,
      firstValue,
      secondValue,
      explanation,
      firstEvidence,
      secondEvidence,
      firstEvidencePositions: findEvidencePositions(
        currentFirst.content,
        firstEvidence,
      ),
      secondEvidencePositions: findEvidencePositions(
        currentSecond.content,
        secondEvidence,
      ),
      confidence: normalizeConfidence(input.contradiction.confidenceScore),
      severity: toSeverity(input.contradiction.severity),
      ...(input.ruleCode ? { ruleCode: input.ruleCode } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.detectionLevel ? { detectionLevel: input.detectionLevel } : {}),
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

  async persistTransition(input: {
    userId: string;
    projectId: string;
    sceneId: string;
    second: AuditChunk;
    transition: ExtractedCrossChunkInconsistency;
    knownEntities: readonly KnownEntity[];
  }): Promise<void> {
    const entity = findKnownEntity(
      input.transition.entityName,
      input.knownEntities,
    );
    const attributeKey = input.transition.field.trim();
    const evidence = cleanEvidence(input.transition.secondEvidence);
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
      confidenceScore: normalizeConfidence(input.transition.confidenceScore),
      narrativeOrder: Math.max(0, input.second.chunkIndex) * 1000,
      sequenceKind: 'TRANSITION',
    });
  }
}
