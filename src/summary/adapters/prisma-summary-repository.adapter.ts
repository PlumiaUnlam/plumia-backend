import { Injectable } from '@nestjs/common';
import { type Summary, type SummaryGenerationJob } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SUMMARY_SCOPE, type SummaryScope } from '../domain/summary-scope';
import type {
  ChapterSummaryInput,
  SceneSummaryInput,
  SummaryJobRecord,
  SummaryRecord,
  SummaryRepository,
} from '../ports/summary-repository.port';

@Injectable()
export class PrismaSummaryRepository implements SummaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSummary(
    userId: string,
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryRecord | null> {
    const summary = await this.prisma.summary.findFirst({
      where: {
        scopeType: scope,
        scopeId,
        project: { userId, deletedAt: null },
      },
    });
    return summary ? this.toSummary(summary) : null;
  }

  async findSummaryByScope(
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryRecord | null> {
    const summary = await this.prisma.summary.findUnique({
      where: { scopeType_scopeId: { scopeType: scope, scopeId } },
    });
    return summary ? this.toSummary(summary) : null;
  }

  async findSceneInput(
    userId: string,
    sceneId: string,
  ): Promise<SceneSummaryInput | null> {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        deletedAt: null,
        chapter: { book: { project: { userId, deletedAt: null } } },
      },
      include: { chapter: { include: { book: true } } },
    });
    return scene ? this.toSceneInput(scene) : null;
  }

  async findSceneInputById(sceneId: string): Promise<SceneSummaryInput | null> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, deletedAt: null },
      include: { chapter: { include: { book: true } } },
    });
    return scene ? this.toSceneInput(scene) : null;
  }

  async findChapterInput(
    userId: string,
    chapterId: string,
  ): Promise<ChapterSummaryInput | null> {
    const chapter = await this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        deletedAt: null,
        book: { project: { userId, deletedAt: null } },
      },
      include: {
        book: true,
        scenes: {
          where: { deletedAt: null },
          orderBy: [{ sortKey: 'asc' }, { order: 'asc' }],
        },
      },
    });
    return chapter ? this.toChapterInput(chapter) : null;
  }

  async findChapterInputById(
    chapterId: string,
  ): Promise<ChapterSummaryInput | null> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, deletedAt: null },
      include: {
        book: true,
        scenes: {
          where: { deletedAt: null },
          orderBy: [{ sortKey: 'asc' }, { order: 'asc' }],
        },
      },
    });
    return chapter ? this.toChapterInput(chapter) : null;
  }

  async createOrGetJob(input: {
    projectId: string;
    scope: SummaryScope;
    scopeId: string;
    inputHash: string;
    force: boolean;
    bullJobId: string;
  }): Promise<SummaryJobRecord> {
    const active = await this.prisma.summaryGenerationJob.findFirst({
      where: {
        scopeType: input.scope,
        scopeId: input.scopeId,
        inputHash: input.inputHash,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      return this.toJob(active);
    }
    const job = await this.prisma.summaryGenerationJob.create({
      data: {
        projectId: input.projectId,
        scopeType: input.scope,
        scopeId: input.scopeId,
        inputHash: input.inputHash,
        force: input.force,
        bullJobId: input.bullJobId,
      },
    });
    return this.toJob(job);
  }

  async findJobForUser(
    userId: string,
    jobId: string,
  ): Promise<SummaryJobRecord | null> {
    const job = await this.prisma.summaryGenerationJob.findFirst({
      where: { id: jobId, project: { userId, deletedAt: null } },
    });
    return job ? this.toJob(job) : null;
  }

  async markJobProcessing(jobId: string): Promise<void> {
    await this.prisma.summaryGenerationJob.update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        progress: 10,
        startedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  async markJobCompleted(jobId: string): Promise<void> {
    await this.prisma.summaryGenerationJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', progress: 100, completedAt: new Date() },
    });
  }

  async markJobFailed(jobId: string, message: string): Promise<void> {
    await this.prisma.summaryGenerationJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
      },
    });
  }

  async upsertGenerated(
    input: Omit<
      SummaryRecord,
      'id' | 'parentSummaryId' | 'createdAt' | 'updatedAt' | 'source'
    >,
  ): Promise<SummaryRecord> {
    const summary = await this.prisma.summary.upsert({
      where: {
        scopeType_scopeId: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
      create: { ...input, source: 'ai_generated' },
      update: {
        title: input.title,
        content: input.content,
        source: 'ai_generated',
        sourceContentHash: input.sourceContentHash,
        provider: input.provider,
        model: input.model,
        isDirty: false,
        tokenCount: input.tokenCount,
      },
    });
    return this.toSummary(summary);
  }

  async updateManual(
    userId: string,
    id: string,
    content: string,
  ): Promise<SummaryRecord | null> {
    const result = await this.prisma.summary.updateMany({
      where: { id, project: { userId, deletedAt: null } },
      data: { content, source: 'author_manual', isDirty: false },
    });
    if (result.count === 0) {
      return null;
    }
    const summary = await this.prisma.summary.findUnique({ where: { id } });
    return summary ? this.toSummary(summary) : null;
  }

  async invalidateScene(
    sceneId: string,
    chapterId: string,
  ): Promise<{ scene: SummaryRecord | null; chapter: SummaryRecord | null }> {
    const [scene, chapter] = await this.prisma.$transaction([
      this.prisma.summary.updateMany({
        where: { scopeType: SUMMARY_SCOPE.SCENE, scopeId: sceneId },
        data: { isDirty: true },
      }),
      this.prisma.summary.updateMany({
        where: { scopeType: SUMMARY_SCOPE.CHAPTER, scopeId: chapterId },
        data: { isDirty: true },
      }),
    ]);
    const records = await this.prisma.summary.findMany({
      where: {
        OR: [
          { scopeType: SUMMARY_SCOPE.SCENE, scopeId: sceneId },
          { scopeType: SUMMARY_SCOPE.CHAPTER, scopeId: chapterId },
        ],
      },
    });
    return {
      scene: scene.count
        ? this.toSummary(
            records.find((item) => item.scopeType === SUMMARY_SCOPE.SCENE)!,
          )
        : null,
      chapter: chapter.count
        ? this.toSummary(
            records.find((item) => item.scopeType === SUMMARY_SCOPE.CHAPTER)!,
          )
        : null,
    };
  }

  private toSceneInput(scene: {
    id: string;
    chapterId: string;
    title: string | null;
    content: unknown;
    contentHash: string | null;
    wordCount: number;
    chapter: { book: { projectId: string } };
  }): SceneSummaryInput {
    return {
      id: scene.id,
      projectId: scene.chapter.book.projectId,
      chapterId: scene.chapterId,
      title: scene.title,
      content: scene.content,
      contentHash: scene.contentHash,
      wordCount: scene.wordCount,
    };
  }

  private toChapterInput(chapter: {
    id: string;
    title: string;
    book: { projectId: string };
    scenes: Array<{
      id: string;
      chapterId: string;
      title: string | null;
      content: unknown;
      contentHash: string | null;
      wordCount: number;
    }>;
  }): ChapterSummaryInput {
    return {
      id: chapter.id,
      projectId: chapter.book.projectId,
      title: chapter.title,
      scenes: chapter.scenes.map((scene) => ({
        ...scene,
        projectId: chapter.book.projectId,
      })),
    };
  }

  private toSummary(summary: Summary): SummaryRecord {
    return {
      ...summary,
      scopeType: summary.scopeType as SummaryScope,
      source: summary.source as SummaryRecord['source'],
    };
  }

  private toJob(job: SummaryGenerationJob): SummaryJobRecord {
    return { ...job, scopeType: job.scopeType as SummaryScope };
  }
}
