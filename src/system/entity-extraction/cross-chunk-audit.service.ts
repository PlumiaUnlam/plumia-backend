import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditLevel, CrossChunkAuditMode, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../knowledge/services/temporal-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import { forEachSequentially } from './for-each-sequentially';
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

interface ContinuityResumePoint {
  startIndex: number;
  claims: ContinuityCheckpointClaim[];
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

    const projectId = scene.chapter.book.projectId;
    const data = await this.loadSceneAuditData({
      sceneId: input.sceneId,
      projectId,
    });
    await this.auditSceneByMode({
      sceneId: scene.id,
      projectId,
      userId: input.userId,
      auditMode: data.auditMode,
      chunks: data.chunks,
      knownEntities: data.knownEntities,
      snapshot: data.snapshot,
      ...(input.onlyDirtyChunkIds
        ? { onlyDirtyChunkIds: input.onlyDirtyChunkIds }
        : {}),
    });
  }

  private async loadSceneAuditData(input: {
    sceneId: string;
    projectId: string;
  }): Promise<{
    chunks: AuditChunk[];
    knownEntities: KnownEntity[];
    snapshot: Awaited<
      ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
    >;
    auditMode: CrossChunkAuditMode;
  }> {
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
          where: { projectId: input.projectId, deletedAt: null },
          select: entitySelect,
        }),
        this.prisma.entityProposal.findMany({
          where: {
            projectId: input.projectId,
            sceneId: input.sceneId,
            status: 'PENDING',
          },
          select: { entityId: true, proposedData: true },
        }),
        this.temporalSnapshotService.getSnapshot(input.sceneId),
        this.prisma.projectKnowledgeReviewSettings?.findUnique?.({
          where: { projectId: input.projectId },
          select: { crossChunkAuditMode: true },
        }),
      ]);
    return {
      chunks,
      knownEntities: this.combineKnownEntities(
        entities,
        pendingEntityProposals,
      ),
      snapshot,
      auditMode:
        settings?.crossChunkAuditMode ?? CrossChunkAuditMode.ADJACENT_CHUNKS,
    };
  }

  private combineKnownEntities(
    entities: Prisma.EntityGetPayload<{ select: typeof entitySelect }>[],
    pendingProposals: Array<{
      entityId: string | null;
      proposedData: Prisma.JsonValue;
    }>,
  ): KnownEntity[] {
    const knownEntities: KnownEntity[] = entities.map((entity) => ({
      ...entity,
      attributes: this.toAttributes(entity.attributes),
    }));
    for (const proposal of pendingProposals) {
      const candidate = this.toProposedEntity(
        proposal.proposedData,
        proposal.entityId,
      );
      if (!candidate) {
        continue;
      }
      const alreadyKnown = knownEntities.some(
        (entity) =>
          this.normalize(entity.canonicalName) ===
          this.normalize(candidate.canonicalName),
      );
      if (!alreadyKnown) {
        knownEntities.push(candidate);
      }
    }
    return knownEntities;
  }

  private async auditSceneByMode(input: {
    sceneId: string;
    projectId: string;
    userId: string;
    auditMode: CrossChunkAuditMode;
    chunks: AuditChunk[];
    knownEntities: KnownEntity[];
    snapshot: Awaited<
      ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
    >;
    onlyDirtyChunkIds?: ReadonlySet<string>;
  }): Promise<void> {
    if (input.auditMode === CrossChunkAuditMode.DISABLED) {
      await this.auditService.obsoleteCrossChunkAlertsForProject({
        projectId: input.projectId,
      });
      return;
    }
    if (input.auditMode === CrossChunkAuditMode.PROJECT_SUMMARY) {
      await this.auditProjectContinuity({
        projectId: input.projectId,
        startSceneId: input.sceneId,
        userId: input.userId,
        knownEntities: input.knownEntities,
      });
      return;
    }

    await this.auditService.obsoleteCrossChunkAlertsForProject({
      projectId: input.projectId,
      ruleCodes: ['CROSS_SCENE_CONTRADICTION'],
    });
    if (input.auditMode === CrossChunkAuditMode.SCENE_GROUPED) {
      const activeFingerprints = new Set<string>();
      await this.auditSceneGroups({
        sceneId: input.sceneId,
        projectId: input.projectId,
        userId: input.userId,
        chunks: input.chunks,
        knownEntities: input.knownEntities,
        snapshot: input.snapshot,
        ...(input.onlyDirtyChunkIds
          ? { onlyDirtyChunkIds: input.onlyDirtyChunkIds }
          : {}),
        activeFingerprints,
      });
      await this.reconcileSceneAuditAlerts({
        sceneId: input.sceneId,
        activeFingerprints,
        ...(input.onlyDirtyChunkIds
          ? { onlyDirtyChunkIds: input.onlyDirtyChunkIds }
          : {}),
      });
      return;
    }

    const activeFingerprints = new Set<string>();
    await this.auditAdjacentChunks({ ...input, activeFingerprints });
    await this.reconcileSceneAuditAlerts({ ...input, activeFingerprints });
  }

  private async auditAdjacentChunks(input: {
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
    const pairIndexes = Array.from(
      { length: Math.max(0, input.chunks.length - 1) },
      (_, index) => index,
    );
    await forEachSequentially(pairIndexes, (index) =>
      this.auditAdjacentPair({
        ...input,
        first: input.chunks[index] as AuditChunk,
        second: input.chunks[index + 1] as AuditChunk,
      }),
    );
  }

  private async auditAdjacentPair(input: {
    sceneId: string;
    projectId: string;
    userId: string;
    first: AuditChunk;
    second: AuditChunk;
    knownEntities: KnownEntity[];
    snapshot: Awaited<
      ReturnType<TemporalKnowledgeSnapshotService['getSnapshot']>
    >;
    onlyDirtyChunkIds?: ReadonlySet<string>;
    activeFingerprints: Set<string>;
  }): Promise<void> {
    if (
      input.onlyDirtyChunkIds &&
      !input.onlyDirtyChunkIds.has(input.first.id) &&
      !input.onlyDirtyChunkIds.has(input.second.id)
    ) {
      return;
    }
    const sharedEntities = this.findSharedEntities(
      input.first.content,
      input.second.content,
      input.knownEntities,
    );
    const contradictions = await this.extractionClient.auditAdjacentChunks({
      userId: input.userId,
      firstText: input.first.content.trim(),
      secondText: input.second.content.trim(),
      knownEntities: sharedEntities.map((entity) => ({
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
              `${input.first.content}\n${input.second.content}`,
            ),
          }
        : {}),
    });
    await forEachSequentially(contradictions, (contradiction) =>
      this.persistAdjacentContradiction({
        ...input,
        sharedEntities,
        contradiction,
      }),
    );
  }

  private async persistAdjacentContradiction(input: {
    sceneId: string;
    projectId: string;
    userId: string;
    first: AuditChunk;
    second: AuditChunk;
    sharedEntities: KnownEntity[];
    activeFingerprints: Set<string>;
    contradiction: Awaited<
      ReturnType<EntityExtractionClient['auditAdjacentChunks']>
    >[number];
  }): Promise<void> {
    if (input.contradiction.kind === 'UNCERTAIN') {
      return;
    }
    if (input.contradiction.kind === 'TRANSITION') {
      await this.persistTransition({
        userId: input.userId,
        projectId: input.projectId,
        sceneId: input.sceneId,
        second: input.second,
        transition: input.contradiction,
        knownEntities: input.sharedEntities,
      });
      return;
    }
    await this.persistContradiction({
      projectId: input.projectId,
      sceneId: input.sceneId,
      first: input.first,
      second: input.second,
      contradiction: input.contradiction,
      knownEntities: input.sharedEntities,
      activeFingerprints: input.activeFingerprints,
    });
  }

  private async reconcileSceneAuditAlerts(input: {
    sceneId: string;
    activeFingerprints: Set<string>;
    onlyDirtyChunkIds?: ReadonlySet<string>;
  }): Promise<void> {
    if (input.onlyDirtyChunkIds) {
      await this.auditService.obsoleteCrossChunkAlertsForChunks({
        sceneId: input.sceneId,
        sourceChunkIds: input.onlyDirtyChunkIds,
        activeFingerprints: input.activeFingerprints,
      });
      return;
    }
    await this.auditService.obsoleteRuleAlertsForScene({
      sceneId: input.sceneId,
      ruleCodes: ['INTRA_SCENE_CONTRADICTION'],
      activeFingerprints: input.activeFingerprints,
    });
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
    const groupStarts = Array.from(
      { length: Math.ceil(Math.max(0, chunks.length - 1) / stride) },
      (_, index) => index * stride,
    );
    await forEachSequentially(groupStarts, (start) =>
      this.auditSceneGroup({ ...input, chunks }, start),
    );
  }

  private async auditSceneGroup(
    input: {
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
    },
    start: number,
  ): Promise<void> {
    const group = input.chunks.slice(start, start + MAX_SCENE_GROUP_CHUNKS);
    if (!this.shouldAuditSceneGroup(group, input.onlyDirtyChunkIds)) {
      return;
    }
    const nonEmpty = group.filter((chunk) => chunk.content.trim().length > 0);
    if (nonEmpty.length < 2) {
      return;
    }
    const groupText = nonEmpty.map((chunk) => chunk.content).join('\n');
    const groupEntities = this.findEntitiesInText(
      groupText,
      input.knownEntities,
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
    await forEachSequentially(contradictions, (contradiction) =>
      this.persistSceneGroupContradiction({
        ...input,
        nonEmpty,
        contradiction,
      }),
    );
  }

  private shouldAuditSceneGroup(
    group: AuditChunk[],
    onlyDirtyChunkIds?: ReadonlySet<string>,
  ): boolean {
    if (group.length < 2) {
      return false;
    }
    return (
      !onlyDirtyChunkIds ||
      group.some((chunk) => onlyDirtyChunkIds.has(chunk.id))
    );
  }

  private findEntitiesInText(
    text: string,
    entities: KnownEntity[],
  ): KnownEntity[] {
    const normalizedText = this.normalize(text);
    return entities.filter((entity) =>
      [entity.canonicalName, ...entity.aliases].some((label) =>
        normalizedText.includes(this.normalize(label)),
      ),
    );
  }

  private async persistSceneGroupContradiction(input: {
    sceneId: string;
    projectId: string;
    nonEmpty: AuditChunk[];
    knownEntities: KnownEntity[];
    activeFingerprints: Set<string>;
    contradiction: Awaited<
      ReturnType<EntityExtractionClient['auditSceneChunkGroup']>
    >[number];
  }): Promise<void> {
    if (input.contradiction.kind === 'UNCERTAIN') {
      return;
    }
    const first = input.nonEmpty.find(
      (chunk) => chunk.chunkIndex === input.contradiction.firstChunkIndex,
    );
    const second = input.nonEmpty.find(
      (chunk) => chunk.chunkIndex === input.contradiction.secondChunkIndex,
    );
    if (!first || !second || first.id === second.id) {
      return;
    }
    await this.persistContradiction({
      projectId: input.projectId,
      sceneId: input.sceneId,
      first,
      second,
      contradiction: input.contradiction,
      knownEntities: input.knownEntities,
      activeFingerprints: input.activeFingerprints,
    });
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
    const resumePoint = await this.resolveContinuityResumePoint({
      projectId: input.projectId,
      scenes,
      scenePositions,
      checkpointCandidates,
    });
    let startIndex = resumePoint.startIndex;

    if (startIndex > targetIndex) {
      startIndex = targetIndex;
    }
    let claims = resumePoint.claims;
    const affectedScenes = scenes.slice(startIndex);
    const affectedChunkIds = new Set(
      affectedScenes.flatMap((scene) => scene.chunks.map((chunk) => chunk.id)),
    );
    const activeFingerprints = new Set<string>();

    let stopAfterCurrentScene = false;
    await forEachSequentially(affectedScenes, async (scene) => {
      if (stopAfterCurrentScene) {
        return;
      }
      const result = await this.processContinuityScene({
        projectId: input.projectId,
        userId: input.userId,
        scene,
        knownEntities: input.knownEntities,
        claims,
        activeFingerprints,
      });
      claims = result.claims;
      stopAfterCurrentScene = !result.isCurrent;
    });

    await this.auditService.obsoleteCrossChunkAlertsForProject({
      projectId: input.projectId,
      affectedChunkIds,
      activeFingerprints,
    });
  }

  private async processContinuityScene(input: {
    projectId: string;
    userId: string;
    scene: ContinuityScene;
    knownEntities: KnownEntity[];
    claims: ContinuityCheckpointClaim[];
    activeFingerprints: Set<string>;
  }): Promise<{ claims: ContinuityCheckpointClaim[]; isCurrent: boolean }> {
    const chunks = [...input.scene.chunks].sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    const result = await this.extractContinuityScene(input, chunks);
    const chunksByIndex = new Map(
      chunks.map((chunk) => [chunk.chunkIndex, chunk] as const),
    );
    await forEachSequentially(result.contradictions, (contradiction) =>
      this.persistContinuityContradiction({
        ...input,
        chunksByIndex,
        contradiction,
      }),
    );
    const verifiedClaims = this.toVerifiedContinuityClaims(
      input.scene.id,
      result.claims,
      chunksByIndex,
    );
    const claims = this.mergeContinuityClaims(input.claims, verifiedClaims);
    const isCurrent = await this.persistContinuityCheckpoint(
      input.projectId,
      input.scene,
      chunks,
      claims,
    );
    return { claims, isCurrent };
  }

  private async extractContinuityScene(
    input: {
      userId: string;
      scene: ContinuityScene;
      knownEntities: KnownEntity[];
      claims: ContinuityCheckpointClaim[];
    },
    chunks: AuditChunk[],
  ): Promise<ExtractedContinuityCheckpoint> {
    const nonEmptyChunks = chunks.filter((chunk) => chunk.content.trim());
    if (nonEmptyChunks.length === 0) {
      return { claims: [], contradictions: [] };
    }
    const snapshot = await this.temporalSnapshotService.getSnapshot(
      input.scene.id,
    );
    return this.extractionClient.auditSceneAgainstContinuityClaims({
      userId: input.userId,
      chunks: nonEmptyChunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        text: chunk.content.trim(),
      })),
      previousClaims: input.claims,
      knownEntities: input.knownEntities.map((entity) => ({
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
              nonEmptyChunks.map((chunk) => chunk.content).join('\n'),
            ),
          }
        : {}),
    });
  }

  private async persistContinuityContradiction(input: {
    projectId: string;
    scene: ContinuityScene;
    knownEntities: KnownEntity[];
    activeFingerprints: Set<string>;
    claims: ContinuityCheckpointClaim[];
    chunksByIndex: Map<number, AuditChunk>;
    contradiction: ExtractedContinuityCheckpoint['contradictions'][number];
  }): Promise<void> {
    const { contradiction } = input;
    const previous = input.claims[contradiction.previousClaimIndex];
    const current = input.chunksByIndex.get(contradiction.currentChunkIndex);
    const evidence = contradiction.currentEvidence.trim();
    if (!previous || !current || !evidence) {
      return;
    }
    if (!current.content.includes(evidence)) {
      return;
    }
    if (previous.value.trim() === contradiction.currentValue.trim()) {
      return;
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
      sceneId: input.scene.id,
      first: {
        id: previous.chunkId,
        chunkIndex: previous.chunkIndex,
        content: await this.getChunkContent(previous.chunkId),
        contentHash: previous.chunkHash,
      },
      second: current,
      contradiction: extracted,
      knownEntities: input.knownEntities,
      activeFingerprints: input.activeFingerprints,
      ruleCode: 'CROSS_SCENE_CONTRADICTION',
      title: 'Posible contradicción con una escena anterior',
      detectionLevel: AuditLevel.INTER_SCENE,
      firstSceneId: previous.sceneId,
      secondSceneId: input.scene.id,
    });
  }

  private toVerifiedContinuityClaims(
    sceneId: string,
    extractedClaims: ExtractedContinuityCheckpoint['claims'],
    chunksByIndex: Map<number, AuditChunk>,
  ): ContinuityCheckpointClaim[] {
    return extractedClaims.flatMap((claim) => {
      const source = chunksByIndex.get(claim.chunkIndex);
      if (!source?.contentHash) {
        return [];
      }
      const entityName = claim.entityName.trim();
      const field = claim.field.trim();
      const value = claim.value.trim();
      const evidence = claim.evidence.trim();
      if (
        !entityName ||
        !field ||
        !value ||
        !evidence ||
        !source.content.includes(evidence)
      ) {
        return [];
      }
      return [
        {
          entityName,
          field,
          value,
          sceneId,
          chunkId: source.id,
          chunkHash: source.contentHash,
          chunkIndex: source.chunkIndex,
          evidence,
        },
      ];
    });
  }

  private async persistContinuityCheckpoint(
    projectId: string,
    scene: ContinuityScene,
    chunks: AuditChunk[],
    claims: ContinuityCheckpointClaim[],
  ): Promise<boolean> {
    const sourceHash = this.hashSceneChunks(chunks);
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
      return false;
    }
    await this.prisma.projectContinuityCheckpoint.upsert({
      where: { projectId_sceneId: { projectId, sceneId: scene.id } },
      create: {
        projectId,
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
    return true;
  }

  private async resolveContinuityResumePoint(input: {
    projectId: string;
    scenes: ContinuityScene[];
    scenePositions: Map<string, number>;
    checkpointCandidates: Array<{
      sceneId: string;
      sourceHash: string;
      claims: Prisma.JsonValue;
    }>;
  }): Promise<ContinuityResumePoint> {
    const resumePoint: ContinuityResumePoint = { startIndex: 0, claims: [] };
    let checkpointFound = false;
    await forEachSequentially(
      input.checkpointCandidates,
      async (checkpoint) => {
        if (checkpointFound) {
          return;
        }
        const checkpointScene = input.scenes.find(
          (scene) => scene.id === checkpoint.sceneId,
        );
        if (!checkpointScene) {
          return;
        }
        const storedClaims = this.parseContinuityClaims(checkpoint.claims);
        const currentClaims = await this.loadCurrentClaims(storedClaims);
        if (
          this.hashSceneChunks(checkpointScene.chunks) ===
            checkpoint.sourceHash &&
          currentClaims.length === storedClaims.length
        ) {
          resumePoint.claims = currentClaims;
          resumePoint.startIndex =
            (input.scenePositions.get(checkpoint.sceneId) ?? -1) + 1;
          checkpointFound = true;
          return;
        }
        await this.prisma.projectContinuityCheckpoint.updateMany({
          where: {
            projectId: input.projectId,
            sceneId: checkpoint.sceneId,
            isValid: true,
          },
          data: { isValid: false },
        });
      },
    );
    return resumePoint;
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
        source?.contentHash === claim.chunkHash &&
        source?.content.includes(claim.evidence) === true,
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
