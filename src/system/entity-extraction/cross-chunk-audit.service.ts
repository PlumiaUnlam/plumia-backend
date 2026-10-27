import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditLevel, CrossChunkAuditMode, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../knowledge/services/temporal-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import type {
  ContinuityCheckpointClaim,
  ExtractedContinuityCheckpoint,
  ExtractedCrossChunkInconsistency,
} from './entity-extraction.types';

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

interface ContinuityScene {
  id: string;
  title: string | null;
  order: number;
  sortKey: string;
  chapter: {
    sortKey: string;
    book: { sortKey: string };
  };
  chunks: AuditChunk[];
}

const MAX_SCENE_GROUP_CHUNKS = 5;
const MAX_CHECKPOINT_CLAIMS = 200;

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

    const [chunks, entities, pendingEntityProposals, snapshot, settings] =
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
        this.prisma.projectKnowledgeReviewSettings?.findUnique?.({
          where: { projectId: scene.chapter.book.projectId },
          select: { crossChunkAuditMode: true },
        }),
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

    const auditMode =
      settings?.crossChunkAuditMode ?? CrossChunkAuditMode.ADJACENT_CHUNKS;
    if (auditMode === CrossChunkAuditMode.DISABLED) {
      await this.auditService.obsoleteCrossChunkAlertsForProject({
        projectId: scene.chapter.book.projectId,
      });
      return;
    }
    if (auditMode === CrossChunkAuditMode.PROJECT_SUMMARY) {
      await this.auditProjectContinuity({
        projectId: scene.chapter.book.projectId,
        startSceneId: scene.id,
        userId: input.userId,
        knownEntities: allKnownEntities,
      });
      return;
    }
    await this.auditService.obsoleteCrossChunkAlertsForProject({
      projectId: scene.chapter.book.projectId,
      ruleCodes: ['CROSS_SCENE_CONTRADICTION'],
    });
    if (auditMode === CrossChunkAuditMode.SCENE_GROUPED) {
      await this.auditSceneGroups({
        sceneId: input.sceneId,
        projectId: scene.chapter.book.projectId,
        userId: input.userId,
        chunks,
        knownEntities: allKnownEntities,
        snapshot,
        ...(input.onlyDirtyChunkIds
          ? { onlyDirtyChunkIds: input.onlyDirtyChunkIds }
          : {}),
        activeFingerprints,
      });
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
      return;
    }

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

  private async auditSceneGroups(input: {
    sceneId: string;
    projectId: string;
    userId: string;
    chunks: AuditChunk[];
    knownEntities: KnownEntity[];
    snapshot: Awaited<
      ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
    >;
    onlyDirtyChunkIds?: ReadonlySet<string>;
    activeFingerprints: Set<string>;
  }): Promise<void> {
    const chunks = [...input.chunks].sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    const stride = MAX_SCENE_GROUP_CHUNKS - 1;
    for (let start = 0; start < chunks.length; start += stride) {
      const group = chunks.slice(start, start + MAX_SCENE_GROUP_CHUNKS);
      if (group.length < 2) {
        break;
      }
      if (
        input.onlyDirtyChunkIds &&
        !group.some((chunk) => input.onlyDirtyChunkIds!.has(chunk.id))
      ) {
        continue;
      }
      const nonEmpty = group.filter((chunk) => chunk.content.trim().length > 0);
      if (nonEmpty.length < 2) {
        continue;
      }
      const groupText = nonEmpty.map((chunk) => chunk.content).join('\n');
      const groupEntities = input.knownEntities.filter((entity) =>
        [entity.canonicalName, ...entity.aliases].some((label) =>
          this.normalize(groupText).includes(this.normalize(label)),
        ),
      );
      const contradictions = await this.extractionClient.auditSceneChunkGroup({
        userId: input.userId,
        chunks: nonEmpty.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          text: chunk.content.trim(),
        })),
        knownEntities: groupEntities.map((entity) => ({
          canonicalName: entity.canonicalName,
          aliases: entity.aliases,
          type: entity.type,
          description: entity.description,
          attributes: entity.attributes,
        })),
        ...(input.snapshot
          ? {
              temporalContext: this.temporalSnapshotService.toExtractionContext(
                input.snapshot,
                groupText,
              ),
            }
          : {}),
      });
      for (const contradiction of contradictions) {
        if (contradiction.kind === 'UNCERTAIN') {
          continue;
        }
        const first = nonEmpty.find(
          (chunk) => chunk.chunkIndex === contradiction.firstChunkIndex,
        );
        const second = nonEmpty.find(
          (chunk) => chunk.chunkIndex === contradiction.secondChunkIndex,
        );
        if (!first || !second || first.id === second.id) {
          continue;
        }
        await this.persistContradiction({
          projectId: input.projectId,
          sceneId: input.sceneId,
          first,
          second,
          contradiction,
          knownEntities: input.knownEntities,
          activeFingerprints: input.activeFingerprints,
        });
      }
      if (start + MAX_SCENE_GROUP_CHUNKS >= chunks.length) {
        break;
      }
    }
  }

  private async auditProjectContinuity(input: {
    projectId: string;
    startSceneId: string;
    userId: string;
    knownEntities: KnownEntity[];
  }): Promise<void> {
    const scenes = (await this.prisma.scene.findMany({
      where: {
        deletedAt: null,
        chapter: {
          deletedAt: null,
          book: { projectId: input.projectId, deletedAt: null },
        },
      },
      select: {
        id: true,
        title: true,
        order: true,
        sortKey: true,
        chapter: {
          select: {
            sortKey: true,
            book: { select: { sortKey: true } },
          },
        },
        chunks: {
          select: {
            id: true,
            chunkIndex: true,
            content: true,
            contentHash: true,
          },
          orderBy: { chunkIndex: 'asc' },
        },
      },
    })) as ContinuityScene[];
    scenes.sort(
      (left, right) =>
        left.chapter.book.sortKey.localeCompare(right.chapter.book.sortKey) ||
        left.chapter.sortKey.localeCompare(right.chapter.sortKey) ||
        left.order - right.order ||
        left.sortKey.localeCompare(right.sortKey) ||
        left.id.localeCompare(right.id),
    );
    const targetIndex = scenes.findIndex(
      (scene) => scene.id === input.startSceneId,
    );
    if (targetIndex < 0) {
      return;
    }

    const priorSceneIds = scenes.slice(0, targetIndex).map((scene) => scene.id);
    const validCheckpoints = priorSceneIds.length
      ? await this.prisma.projectContinuityCheckpoint.findMany({
          where: {
            projectId: input.projectId,
            isValid: true,
            sceneId: { in: priorSceneIds },
          },
          select: { sceneId: true, sourceHash: true, claims: true },
        })
      : [];
    const scenePositions = new Map(
      scenes.map((scene, index) => [scene.id, index] as const),
    );
    const checkpointCandidates = validCheckpoints.sort(
      (left, right) =>
        (scenePositions.get(right.sceneId) ?? -1) -
        (scenePositions.get(left.sceneId) ?? -1),
    );
    let startIndex = 0;
    let claims: ContinuityCheckpointClaim[] = [];
    for (const checkpoint of checkpointCandidates) {
      const checkpointScene = scenes.find(
        (scene) => scene.id === checkpoint.sceneId,
      );
      if (!checkpointScene) {
        continue;
      }
      const storedClaims = this.parseContinuityClaims(checkpoint.claims);
      const currentClaims = await this.loadCurrentClaims(storedClaims);
      const checkpointIsCurrent =
        this.hashSceneChunks(checkpointScene.chunks) ===
          checkpoint.sourceHash && currentClaims.length === storedClaims.length;
      if (checkpointIsCurrent) {
        claims = currentClaims;
        startIndex = (scenePositions.get(checkpoint.sceneId) ?? -1) + 1;
        break;
      }
      await this.prisma.projectContinuityCheckpoint.updateMany({
        where: {
          projectId: input.projectId,
          sceneId: checkpoint.sceneId,
          isValid: true,
        },
        data: { isValid: false },
      });
    }

    if (startIndex > targetIndex) {
      startIndex = targetIndex;
    }
    const affectedScenes = scenes.slice(startIndex);
    const affectedChunkIds = new Set(
      affectedScenes.flatMap((scene) => scene.chunks.map((chunk) => chunk.id)),
    );
    const activeFingerprints = new Set<string>();

    for (const scene of affectedScenes) {
      const currentChunks = [...scene.chunks].sort(
        (left, right) => left.chunkIndex - right.chunkIndex,
      );
      const nonEmpty = currentChunks.filter((chunk) => chunk.content.trim());
      let result: ExtractedContinuityCheckpoint = {
        claims: [],
        contradictions: [],
      };
      if (nonEmpty.length > 0) {
        const snapshot = await this.temporalSnapshotService.getSnapshot(
          scene.id,
        );
        result = await this.extractionClient.auditSceneAgainstContinuityClaims({
          userId: input.userId,
          chunks: nonEmpty.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            text: chunk.content.trim(),
          })),
          previousClaims: claims,
          knownEntities: input.knownEntities.map((entity) => ({
            canonicalName: entity.canonicalName,
            aliases: entity.aliases,
            type: entity.type,
            description: entity.description,
            attributes: entity.attributes,
          })),
          ...(snapshot
            ? {
                temporalContext:
                  this.temporalSnapshotService.toExtractionContext(
                    snapshot,
                    nonEmpty.map((chunk) => chunk.content).join('\n'),
                  ),
              }
            : {}),
        });
      }

      const chunksByIndex = new Map(
        currentChunks.map((chunk) => [chunk.chunkIndex, chunk] as const),
      );
      for (const contradiction of result.contradictions) {
        const previous = claims[contradiction.previousClaimIndex];
        const current = chunksByIndex.get(contradiction.currentChunkIndex);
        const evidence = contradiction.currentEvidence.trim();
        if (
          !previous ||
          !current ||
          !evidence ||
          !current.content.includes(evidence) ||
          previous.value.trim() === contradiction.currentValue.trim()
        ) {
          continue;
        }
        const extracted: ExtractedCrossChunkInconsistency = {
          entityName: contradiction.entityName,
          field: contradiction.field,
          firstValue: previous.value,
          secondValue: contradiction.currentValue,
          explanation: contradiction.explanation,
          severity: contradiction.severity,
          confidenceScore: contradiction.confidenceScore,
          firstEvidence: [previous.evidence],
          secondEvidence: [evidence],
        };
        await this.persistContradiction({
          projectId: input.projectId,
          sceneId: scene.id,
          first: {
            id: previous.chunkId,
            chunkIndex: previous.chunkIndex,
            content: await this.getChunkContent(previous.chunkId),
            contentHash: previous.chunkHash,
          },
          second: current,
          contradiction: extracted,
          knownEntities: input.knownEntities,
          activeFingerprints,
          ruleCode: 'CROSS_SCENE_CONTRADICTION',
          title: 'Posible contradicción con una escena anterior',
          detectionLevel: AuditLevel.INTER_SCENE,
          firstSceneId: previous.sceneId,
          secondSceneId: scene.id,
        });
      }

      const verifiedClaims = result.claims.flatMap((claim) => {
        const source = chunksByIndex.get(claim.chunkIndex);
        const evidence = claim.evidence.trim();
        if (
          !source ||
          !source.contentHash ||
          !claim.entityName.trim() ||
          !claim.field.trim() ||
          !claim.value.trim() ||
          !evidence ||
          !source.content.includes(evidence)
        ) {
          return [];
        }
        return [
          {
            entityName: claim.entityName.trim(),
            field: claim.field.trim(),
            value: claim.value.trim(),
            sceneId: scene.id,
            chunkId: source.id,
            chunkHash: source.contentHash,
            chunkIndex: source.chunkIndex,
            evidence,
          },
        ];
      });
      claims = this.mergeContinuityClaims(claims, verifiedClaims);
      const sourceHash = this.hashSceneChunks(currentChunks);
      const latestChunks = await this.prisma.chunk.findMany({
        where: { sceneId: scene.id },
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          contentHash: true,
        },
        orderBy: { chunkIndex: 'asc' },
      });
      if (this.hashSceneChunks(latestChunks) !== sourceHash) {
        break;
      }
      await this.prisma.projectContinuityCheckpoint.upsert({
        where: {
          projectId_sceneId: { projectId: input.projectId, sceneId: scene.id },
        },
        create: {
          projectId: input.projectId,
          sceneId: scene.id,
          sourceHash,
          claims: claims as unknown as Prisma.InputJsonValue,
          isValid: true,
        },
        update: {
          sourceHash,
          claims: claims as unknown as Prisma.InputJsonValue,
          isValid: true,
        },
      });
    }

    await this.auditService.obsoleteCrossChunkAlertsForProject({
      projectId: input.projectId,
      affectedChunkIds,
      activeFingerprints,
    });
  }

  private async getChunkContent(chunkId: string): Promise<string> {
    const chunk = await this.prisma.chunk.findUnique({
      where: { id: chunkId },
      select: { content: true },
    });
    return chunk?.content ?? '';
  }

  private parseContinuityClaims(value: unknown): ContinuityCheckpointClaim[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is ContinuityCheckpointClaim => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const claim = item as Record<string, unknown>;
      return (
        typeof claim['entityName'] === 'string' &&
        typeof claim['field'] === 'string' &&
        typeof claim['value'] === 'string' &&
        typeof claim['sceneId'] === 'string' &&
        typeof claim['chunkId'] === 'string' &&
        typeof claim['chunkHash'] === 'string' &&
        typeof claim['chunkIndex'] === 'number' &&
        typeof claim['evidence'] === 'string'
      );
    });
  }

  private async loadCurrentClaims(
    claims: ContinuityCheckpointClaim[],
  ): Promise<ContinuityCheckpointClaim[]> {
    if (claims.length === 0) {
      return [];
    }
    const chunks = await this.prisma.chunk.findMany({
      where: { id: { in: [...new Set(claims.map((claim) => claim.chunkId))] } },
      select: { id: true, content: true, contentHash: true },
    });
    const chunksById = new Map(
      chunks.map((chunk) => [chunk.id, chunk] as const),
    );
    return claims.filter((claim) => {
      const source = chunksById.get(claim.chunkId);
      return Boolean(
        source &&
        source.contentHash === claim.chunkHash &&
        source.content.includes(claim.evidence),
      );
    });
  }

  private mergeContinuityClaims(
    previous: ContinuityCheckpointClaim[],
    current: ContinuityCheckpointClaim[],
  ): ContinuityCheckpointClaim[] {
    const latest = new Map<string, ContinuityCheckpointClaim>();
    for (const claim of [...previous, ...current]) {
      latest.set(
        `${this.normalize(claim.entityName)}:${this.normalize(claim.field)}`,
        claim,
      );
    }
    return [...latest.values()].slice(-MAX_CHECKPOINT_CLAIMS);
  }

  private hashSceneChunks(chunks: AuditChunk[]): string {
    return createHash('sha256')
      .update(
        [...chunks]
          .sort((left, right) => left.chunkIndex - right.chunkIndex)
          .map((chunk) => `${chunk.chunkIndex}:${chunk.contentHash ?? ''}`)
          .join('|'),
      )
      .digest('hex');
  }

  private async persistContradiction(input: {
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
    const firstEvidence = this.cleanEvidence(
      input.contradiction.firstEvidence,
    ).filter((quote) => currentFirst.content.includes(quote));
    const secondEvidence = this.cleanEvidence(
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
      firstEvidencePositions: this.findEvidencePositions(
        currentFirst.content,
        firstEvidence,
      ),
      secondEvidencePositions: this.findEvidencePositions(
        currentSecond.content,
        secondEvidence,
      ),
      confidence: this.normalizeConfidence(input.contradiction.confidenceScore),
      severity: this.toSeverity(input.contradiction.severity),
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
