import { Injectable } from '@nestjs/common';
import { CrossChunkAuditMode } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { TemporalKnowledgeSnapshotService } from '../../audit/temporal-knowledge-snapshot.service';
import { TemporalStateService } from '../../knowledge/services/temporal-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityExtractionClient } from './entity-extraction.client';
import { EntityResolutionService } from './entity-resolution.service';
import { forEachSequentially } from './for-each-sequentially';
import {
  AuditChunk,
  KnownEntity,
  entitySelect,
} from './cross-chunk-audit.types';
import {
  combineKnownEntities,
  findSharedEntities,
} from './cross-chunk-audit.helpers';
import { CrossChunkAuditPersistence } from './cross-chunk-audit.persistence';
import { ProjectContinuityAudit } from './project-continuity-audit';
import { SceneGroupAudit } from './scene-group-audit';

/** Routes scene audits while collaborators handle persistence and continuity workflows. */
@Injectable()
export class CrossChunkAuditService {
  private readonly persistence: CrossChunkAuditPersistence;
  private readonly sceneGroups: SceneGroupAudit;
  private readonly continuity: ProjectContinuityAudit;
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionClient: EntityExtractionClient,
    private readonly resolution: EntityResolutionService,
    private readonly auditService: AuditService,
    private readonly temporalSnapshotService: TemporalKnowledgeSnapshotService,
    private readonly temporalStates: TemporalStateService,
  ) {
    this.persistence = new CrossChunkAuditPersistence(
      this.prisma,
      this.resolution,
      this.auditService,
      this.temporalStates,
    );
    this.sceneGroups = new SceneGroupAudit(
      this.extractionClient,
      this.temporalSnapshotService,
      this.persistence,
    );
    this.continuity = new ProjectContinuityAudit(
      this.prisma,
      this.extractionClient,
      this.temporalSnapshotService,
      this.auditService,
      this.persistence,
    );
  }
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
      knownEntities: combineKnownEntities(entities, pendingEntityProposals),
      snapshot,
      auditMode:
        settings?.crossChunkAuditMode ?? CrossChunkAuditMode.ADJACENT_CHUNKS,
    };
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
      await this.continuity.auditProjectContinuity({
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
      await this.sceneGroups.auditSceneGroups({
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
    const sharedEntities = findSharedEntities(
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
      await this.persistence.persistTransition({
        userId: input.userId,
        projectId: input.projectId,
        sceneId: input.sceneId,
        second: input.second,
        transition: input.contradiction,
        knownEntities: input.sharedEntities,
      });
      return;
    }
    await this.persistence.persistContradiction({
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
}
