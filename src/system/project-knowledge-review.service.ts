import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KnowledgeAnalysisRunStatus,
  KnowledgeAnalysisSceneStatus,
  KnowledgeReviewMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateKnowledgeReviewSettingsDto } from './dto/update-knowledge-review-settings.dto';

interface PendingScene {
  id: string;
  title: string | null;
  order: number;
  sortKey: string;
  chapter: {
    title: string;
    sortKey: string;
    book: { title: string; sortKey: string };
  };
  chunks: Array<{ id: string; chunkIndex: number; isDirty: boolean }>;
}

@Injectable()
export class ProjectKnowledgeReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string, projectId: string) {
    await this.assertProjectAccess(userId, projectId);
    const settings = await this.prisma.projectKnowledgeReviewSettings.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });
    return this.toSettingsResponse(settings);
  }

  async updateSettings(
    userId: string,
    projectId: string,
    dto: UpdateKnowledgeReviewSettingsDto,
  ) {
    await this.assertProjectAccess(userId, projectId);
    const settings = await this.prisma.projectKnowledgeReviewSettings.upsert({
      where: { projectId },
      create: {
        projectId,
        stateReviewMode: dto.stateReviewMode,
        stateConfidenceThreshold: dto.stateConfidenceThreshold,
        relationshipReviewMode: dto.relationshipReviewMode,
        relationshipConfidenceThreshold: dto.relationshipConfidenceThreshold,
      },
      update: {
        stateReviewMode: dto.stateReviewMode,
        stateConfidenceThreshold: dto.stateConfidenceThreshold,
        relationshipReviewMode: dto.relationshipReviewMode,
        relationshipConfidenceThreshold: dto.relationshipConfidenceThreshold,
      },
    });
    return this.toSettingsResponse(settings);
  }

  async previewAnalysis(userId: string, projectId: string) {
    await this.assertProjectAccess(userId, projectId);
    const scenes = await this.getPendingScenes(projectId);
    const adjacentPairs = scenes.reduce((count, scene) => {
      const chunksByIndex = new Map(
        scene.chunks.map((chunk) => [chunk.chunkIndex, chunk]),
      );
      return (
        count +
        scene.chunks.filter(
          (chunk) =>
            chunk.isDirty &&
            chunksByIndex.get(chunk.chunkIndex + 1) !== undefined,
        ).length +
        scene.chunks.filter(
          (chunk) =>
            !chunk.isDirty &&
            chunksByIndex.get(chunk.chunkIndex + 1)?.isDirty === true,
        ).length
      );
    }, 0);

    return {
      projectId,
      sceneCount: scenes.length,
      chunkCount: scenes.reduce(
        (total, scene) =>
          total + scene.chunks.filter((chunk) => chunk.isDirty).length,
        0,
      ),
      affectedAdjacentPairs: Math.ceil(adjacentPairs),
      scenes: scenes.map((scene) => ({
        id: scene.id,
        title: scene.title ?? 'Escena sin título',
        chapterTitle: scene.chapter.title,
        bookTitle: scene.chapter.book.title,
        pendingChunks: scene.chunks.filter((chunk) => chunk.isDirty).length,
      })),
    };
  }

  async startAnalysis(userId: string, projectId: string) {
    await this.assertProjectAccess(userId, projectId);
    return this.prisma.$transaction(
      async (tx) => {
        const active = await tx.knowledgeAnalysisRun.findFirst({
          where: {
            projectId,
            status: {
              in: [
                KnowledgeAnalysisRunStatus.QUEUED,
                KnowledgeAnalysisRunStatus.RUNNING,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (active) {
          return {
            status: 'ALREADY_QUEUED' as const,
            run: await this.getRunWith(tx, active.id),
          };
        }

        const scenes = await this.getPendingScenes(projectId, tx);
        if (scenes.length === 0) {
          return { status: 'NO_CHANGES' as const, run: null };
        }

        const run = await tx.knowledgeAnalysisRun.create({
          data: {
            projectId,
            requestedById: userId,
            totalScenes: scenes.length,
            totalChunks: scenes.reduce(
              (total, scene) =>
                total + scene.chunks.filter((chunk) => chunk.isDirty).length,
              0,
            ),
            scenes: {
              create: scenes.map((scene, narrativePosition) => ({
                sceneId: scene.id,
                narrativePosition,
                totalChunks: scene.chunks.filter((chunk) => chunk.isDirty)
                  .length,
              })),
            },
          },
        });
        await tx.outbox.create({
          data: {
            aggregateType: 'Project',
            aggregateId: projectId,
            eventType: 'project_analysis_requested',
            payload: { runId: run.id, userId },
            createdAt: new Date(),
          },
        });
        return {
          status: 'QUEUED' as const,
          run: await this.getRunWith(tx, run.id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async retryFailed(userId: string, projectId: string, runId: string) {
    await this.assertProjectAccess(userId, projectId);
    const previous = await this.prisma.knowledgeAnalysisRun.findFirst({
      where: { id: runId, projectId },
      include: {
        scenes: {
          where: { status: KnowledgeAnalysisSceneStatus.FAILED },
          select: { sceneId: true },
        },
      },
    });
    if (!previous) {
      throw new NotFoundException('Analysis run not found');
    }
    if (previous.scenes.length === 0) {
      throw new BadRequestException('There are no failed scenes to retry');
    }

    return this.prisma.$transaction(async (tx) => {
      const failedSceneIds = previous.scenes.map((scene) => scene.sceneId);
      const scenes = await this.getPendingScenes(projectId, tx, failedSceneIds);
      if (scenes.length === 0) {
        throw new BadRequestException('Failed scenes have no pending chunks');
      }
      const run = await tx.knowledgeAnalysisRun.create({
        data: {
          projectId,
          requestedById: userId,
          totalScenes: scenes.length,
          totalChunks: scenes.reduce(
            (total, scene) =>
              total + scene.chunks.filter((chunk) => chunk.isDirty).length,
            0,
          ),
          scenes: {
            create: scenes.map((scene, narrativePosition) => ({
              sceneId: scene.id,
              narrativePosition,
              totalChunks: scene.chunks.filter((chunk) => chunk.isDirty).length,
            })),
          },
        },
      });
      await tx.outbox.create({
        data: {
          aggregateType: 'Project',
          aggregateId: projectId,
          eventType: 'project_analysis_requested',
          payload: { runId: run.id, userId },
          createdAt: new Date(),
        },
      });
      return {
        status: 'QUEUED' as const,
        run: await this.getRunWith(tx, run.id),
      };
    });
  }

  async getRun(userId: string, projectId: string, runId: string) {
    await this.assertProjectAccess(userId, projectId);
    const run = await this.prisma.knowledgeAnalysisRun.findFirst({
      where: { id: runId, projectId },
    });
    if (!run) {
      throw new NotFoundException('Analysis run not found');
    }
    return this.getRunWith(this.prisma, runId);
  }

  private async getPendingScenes(
    projectId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
    onlySceneIds?: string[],
  ): Promise<PendingScene[]> {
    return client.scene.findMany({
      where: {
        deletedAt: null,
        ...(onlySceneIds ? { id: { in: onlySceneIds } } : {}),
        chapter: {
          deletedAt: null,
          book: { projectId, deletedAt: null },
        },
        chunks: { some: { isDirty: true } },
      },
      select: {
        id: true,
        title: true,
        order: true,
        sortKey: true,
        chapter: {
          select: {
            title: true,
            sortKey: true,
            book: { select: { title: true, sortKey: true } },
          },
        },
        chunks: {
          select: { id: true, chunkIndex: true, isDirty: true },
          orderBy: { chunkIndex: 'asc' },
        },
      },
      orderBy: [
        { chapter: { book: { sortKey: 'asc' } } },
        { chapter: { sortKey: 'asc' } },
        { order: 'asc' },
        { sortKey: 'asc' },
      ],
    });
  }

  private async getRunWith(
    client: PrismaService | Prisma.TransactionClient,
    runId: string,
  ) {
    const run = await client.knowledgeAnalysisRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        scenes: {
          include: {
            scene: {
              select: {
                title: true,
                chapter: {
                  select: {
                    title: true,
                    book: { select: { title: true } },
                  },
                },
              },
            },
          },
          orderBy: { narrativePosition: 'asc' },
        },
      },
    });
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      totalScenes: run.totalScenes,
      processedScenes: run.processedScenes,
      failedScenes: run.failedScenes,
      totalChunks: run.totalChunks,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      scenes: run.scenes.map((item) => ({
        id: item.sceneId,
        title: item.scene.title ?? 'Escena sin título',
        chapterTitle: item.scene.chapter.title,
        bookTitle: item.scene.chapter.book.title,
        status: item.status,
        totalChunks: item.totalChunks,
        processedChunks: item.processedChunks,
        error: item.error,
      })),
    };
  }

  private async assertProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }

  private toSettingsResponse(settings: {
    stateReviewMode: KnowledgeReviewMode;
    stateConfidenceThreshold: Prisma.Decimal;
    relationshipReviewMode: KnowledgeReviewMode;
    relationshipConfidenceThreshold: Prisma.Decimal;
    updatedAt: Date;
  }) {
    return {
      stateReviewMode: settings.stateReviewMode,
      stateConfidenceThreshold: Number(settings.stateConfidenceThreshold),
      relationshipReviewMode: settings.relationshipReviewMode,
      relationshipConfidenceThreshold: Number(
        settings.relationshipConfidenceThreshold,
      ),
      updatedAt: settings.updatedAt,
    };
  }
}
