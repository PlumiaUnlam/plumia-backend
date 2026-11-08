import { AuditLevel, type Prisma } from '@prisma/client';
import { type AuditService } from '../../audit/audit.service';
import { type TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { type PrismaService } from '../../prisma/prisma.service';
import { type EntityExtractionClient } from './entity-extraction.client';
import { forEachSequentially } from './for-each-sequentially';
import type {
  ContinuityCheckpointClaim,
  ExtractedContinuityCheckpoint,
  ExtractedCrossChunkInconsistency,
} from './entity-extraction.types';
import {
  type AuditChunk,
  type KnownEntity,
  type ContinuityScene,
  type ContinuityResumePoint,
} from './cross-chunk-audit.types';
import {
  toVerifiedContinuityClaims,
  parseContinuityClaims,
  mergeContinuityClaims,
  hashSceneChunks,
} from './cross-chunk-audit.helpers';
import { type CrossChunkAuditPersistence } from './cross-chunk-audit.persistence';

export class ProjectContinuityAudit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly temporalSnapshotService: TemporalKnowledgeSnapshotService,
    private readonly auditService: AuditService,
    private readonly persistence: CrossChunkAuditPersistence,
  ) {}
  async auditProjectContinuity(input: {
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
    const verifiedClaims = toVerifiedContinuityClaims(
      input.scene.id,
      result.claims,
      chunksByIndex,
    );
    const claims = mergeContinuityClaims(input.claims, verifiedClaims);
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
    await this.persistence.persistContradiction({
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

  private async persistContinuityCheckpoint(
    projectId: string,
    scene: ContinuityScene,
    chunks: AuditChunk[],
    claims: ContinuityCheckpointClaim[],
  ): Promise<boolean> {
    const sourceHash = hashSceneChunks(chunks);
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
    if (hashSceneChunks(latestChunks) !== sourceHash) {
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
        const storedClaims = parseContinuityClaims(checkpoint.claims);
        const currentClaims = await this.loadCurrentClaims(storedClaims);
        if (
          hashSceneChunks(checkpointScene.chunks) === checkpoint.sourceHash &&
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
}
