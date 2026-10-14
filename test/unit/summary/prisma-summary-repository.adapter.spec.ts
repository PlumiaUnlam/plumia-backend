import { SUMMARY_SCOPE } from '../../../src/summary/domain/summary-scope';
import type {
  SummaryJobRecord,
  SummaryRecord,
} from '../../../src/summary/ports/summary-repository.port';
import { PrismaSummaryRepository } from '../../../src/summary/adapters/prisma-summary-repository.adapter';

describe('PrismaSummaryRepository', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const prisma = {
    summary: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    scene: { findFirst: jest.fn() },
    chapter: { findFirst: jest.fn() },
    summaryGenerationJob: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const repository = new PrismaSummaryRepository(prisma as never);

  beforeEach(() => jest.resetAllMocks());

  it('finds summaries by owned scope and by unique scope, including missing records', async () => {
    prisma.summary.findFirst.mockResolvedValue(summaryRecord());
    prisma.summary.findUnique.mockResolvedValue(summaryRecord());

    await expect(
      repository.findSummary('user-1', SUMMARY_SCOPE.SCENE, 'scene-1'),
    ).resolves.toMatchObject({
      id: 'summary-1',
      scopeType: SUMMARY_SCOPE.SCENE,
    });
    expect(prisma.summary.findFirst).toHaveBeenCalledWith({
      where: {
        scopeType: SUMMARY_SCOPE.SCENE,
        scopeId: 'scene-1',
        project: { userId: 'user-1', deletedAt: null },
      },
    });

    await expect(
      repository.findSummaryByScope(SUMMARY_SCOPE.CHAPTER, 'chapter-1'),
    ).resolves.toMatchObject({ id: 'summary-1' });
    expect(prisma.summary.findUnique).toHaveBeenCalledWith({
      where: {
        scopeType_scopeId: {
          scopeType: SUMMARY_SCOPE.CHAPTER,
          scopeId: 'chapter-1',
        },
      },
    });

    prisma.summary.findFirst.mockResolvedValueOnce(null);
    prisma.summary.findUnique.mockResolvedValueOnce(null);
    await expect(
      repository.findSummary('user-1', SUMMARY_SCOPE.SCENE, 'missing'),
    ).resolves.toBeNull();
    await expect(
      repository.findSummaryByScope(SUMMARY_SCOPE.SCENE, 'missing'),
    ).resolves.toBeNull();
  });

  it('loads owned scenes and scene inputs without owner filtering', async () => {
    prisma.scene.findFirst.mockResolvedValue(sceneInputRecord());

    await expect(
      repository.findSceneInput('user-1', 'scene-1'),
    ).resolves.toEqual({
      id: 'scene-1',
      projectId: 'project-1',
      chapterId: 'chapter-1',
      title: 'Opening',
      content: { type: 'doc' },
      contentHash: 'scene-hash',
      wordCount: 12,
    });
    expect(prisma.scene.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'scene-1',
          deletedAt: null,
          chapter: { book: { project: { userId: 'user-1', deletedAt: null } } },
        },
      }),
    );

    await expect(
      repository.findSceneInputById('scene-1'),
    ).resolves.toMatchObject({ projectId: 'project-1' });
    expect(prisma.scene.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'scene-1', deletedAt: null } }),
    );

    prisma.scene.findFirst.mockResolvedValueOnce(null);
    prisma.scene.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.findSceneInput('user-1', 'missing'),
    ).resolves.toBeNull();
    await expect(repository.findSceneInputById('missing')).resolves.toBeNull();
  });

  it('maps owned chapter inputs in sort order and returns null for unavailable chapters', async () => {
    prisma.chapter.findFirst.mockResolvedValue(chapterInputRecord());

    await expect(
      repository.findChapterInput('user-1', 'chapter-1'),
    ).resolves.toEqual({
      id: 'chapter-1',
      projectId: 'project-1',
      title: 'Chapter',
      scenes: [
        {
          id: 'scene-1',
          chapterId: 'chapter-1',
          title: 'Opening',
          content: { type: 'doc' },
          contentHash: 'scene-hash',
          wordCount: 12,
          projectId: 'project-1',
        },
      ],
    });
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'chapter-1',
          deletedAt: null,
          book: { project: { userId: 'user-1', deletedAt: null } },
        },
      }),
    );

    await expect(
      repository.findChapterInputById('chapter-1'),
    ).resolves.toMatchObject({ id: 'chapter-1' });
    expect(prisma.chapter.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'chapter-1', deletedAt: null } }),
    );

    prisma.chapter.findFirst.mockResolvedValueOnce(null);
    prisma.chapter.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.findChapterInput('user-1', 'missing'),
    ).resolves.toBeNull();
    await expect(
      repository.findChapterInputById('missing'),
    ).resolves.toBeNull();
  });

  it('returns an existing in-flight job or creates a new generation job', async () => {
    const input = {
      projectId: 'project-1',
      scope: SUMMARY_SCOPE.SCENE,
      scopeId: 'scene-1',
      inputHash: 'hash-1',
      force: true,
      bullJobId: 'bull-1',
    };
    prisma.summaryGenerationJob.findFirst.mockResolvedValue(jobRecord());

    await expect(repository.createOrGetJob(input)).resolves.toMatchObject({
      id: 'job-1',
      scopeType: SUMMARY_SCOPE.SCENE,
    });
    expect(prisma.summaryGenerationJob.create).not.toHaveBeenCalled();

    prisma.summaryGenerationJob.findFirst.mockResolvedValueOnce(null);
    prisma.summaryGenerationJob.create.mockResolvedValue(jobRecord());
    await expect(repository.createOrGetJob(input)).resolves.toMatchObject({
      id: 'job-1',
    });
    expect(prisma.summaryGenerationJob.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        scopeType: SUMMARY_SCOPE.SCENE,
        scopeId: 'scene-1',
        inputHash: 'hash-1',
        force: true,
        bullJobId: 'bull-1',
      },
    });
  });

  it('finds jobs scoped to an active owner project and handles missing jobs', async () => {
    prisma.summaryGenerationJob.findFirst.mockResolvedValue(jobRecord());

    await expect(
      repository.findJobForUser('user-1', 'job-1'),
    ).resolves.toMatchObject({ id: 'job-1' });
    expect(prisma.summaryGenerationJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', project: { userId: 'user-1', deletedAt: null } },
    });

    prisma.summaryGenerationJob.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.findJobForUser('user-2', 'job-1'),
    ).resolves.toBeNull();
  });

  it('updates generation job states and truncates long failure messages', async () => {
    await repository.markJobProcessing('job-1');
    expect(prisma.summaryGenerationJob.update).toHaveBeenCalledTimes(1);
    const updates = prisma.summaryGenerationJob.update.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(updates[0]?.[0].data).toMatchObject({
      status: 'PROCESSING',
      progress: 10,
      errorMessage: null,
    });
    await repository.markJobCompleted('job-1');
    expect(updates[1]?.[0].data).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
    });
    await repository.markJobFailed('job-1', 'x'.repeat(2100));
    const failure = updates[2]?.[0] as {
      data: { errorMessage: string };
    };
    expect(failure.data.errorMessage).toHaveLength(2000);
    expect(failure.data.errorMessage).toMatch(/^x+$/);
  });

  it('upserts generated content and maps the persisted summary', async () => {
    prisma.summary.upsert.mockResolvedValue(summaryRecord());
    const input = {
      projectId: 'project-1',
      scopeType: SUMMARY_SCOPE.SCENE,
      scopeId: 'scene-1',
      title: 'Opening',
      content: 'Summary',
      sourceContentHash: 'source-hash',
      provider: 'provider',
      model: 'model',
      isDirty: true,
      tokenCount: 20,
    } as never;

    await expect(repository.upsertGenerated(input)).resolves.toMatchObject({
      id: 'summary-1',
      source: 'ai_generated',
    });
    const upsertCalls = prisma.summary.upsert.mock.calls as Array<
      [
        {
          where: {
            scopeType_scopeId: { scopeType: string; scopeId: string };
          };
          create: { source: string };
          update: { isDirty: boolean };
        },
      ]
    >;
    const upsertInput = upsertCalls[0]?.[0];
    expect(upsertInput?.where.scopeType_scopeId).toEqual({
      scopeType: SUMMARY_SCOPE.SCENE,
      scopeId: 'scene-1',
    });
    expect(upsertInput?.create.source).toBe('ai_generated');
    expect(upsertInput?.update.isDirty).toBe(false);
  });

  it('updates manual content only for an owned summary and handles records that disappear', async () => {
    prisma.summary.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.updateManual('user-1', 'summary-1', 'Manual'),
    ).resolves.toBeNull();
    expect(prisma.summary.findUnique).not.toHaveBeenCalled();

    prisma.summary.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.summary.findUnique.mockResolvedValueOnce(
      summaryRecord({
        source: 'author_manual',
        content: 'Manual',
      }),
    );
    await expect(
      repository.updateManual('user-1', 'summary-1', 'Manual'),
    ).resolves.toMatchObject({ source: 'author_manual', content: 'Manual' });

    prisma.summary.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.summary.findUnique.mockResolvedValueOnce(null);
    await expect(
      repository.updateManual('user-1', 'summary-1', 'Manual'),
    ).resolves.toBeNull();
  });

  it('invalidates scene and chapter summaries independently', async () => {
    const sceneSummary = summaryRecord({ scopeType: SUMMARY_SCOPE.SCENE });
    const chapterSummary = summaryRecord({
      id: 'chapter-summary',
      scopeType: SUMMARY_SCOPE.CHAPTER,
      scopeId: 'chapter-1',
    });
    prisma.$transaction.mockResolvedValue([{ count: 1 }, { count: 1 }]);
    prisma.summary.findMany.mockResolvedValue([sceneSummary, chapterSummary]);

    await expect(
      repository.invalidateScene('scene-1', 'chapter-1'),
    ).resolves.toMatchObject({
      scene: { id: 'summary-1' },
      chapter: { id: 'chapter-summary' },
    });
    expect(prisma.summary.updateMany).toHaveBeenNthCalledWith(1, {
      where: { scopeType: SUMMARY_SCOPE.SCENE, scopeId: 'scene-1' },
      data: { isDirty: true },
    });
    expect(prisma.summary.updateMany).toHaveBeenNthCalledWith(2, {
      where: { scopeType: SUMMARY_SCOPE.CHAPTER, scopeId: 'chapter-1' },
      data: { isDirty: true },
    });

    prisma.$transaction.mockResolvedValueOnce([{ count: 0 }, { count: 1 }]);
    prisma.summary.findMany.mockResolvedValueOnce([chapterSummary]);
    await expect(
      repository.invalidateScene('scene-1', 'chapter-1'),
    ).resolves.toMatchObject({
      scene: null,
      chapter: { id: 'chapter-summary' },
    });

    prisma.$transaction.mockResolvedValueOnce([{ count: 0 }, { count: 0 }]);
    prisma.summary.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.invalidateScene('scene-1', 'chapter-1'),
    ).resolves.toEqual({ scene: null, chapter: null });
  });

  function summaryRecord(
    overrides: Partial<SummaryRecord> = {},
  ): SummaryRecord {
    return {
      id: 'summary-1',
      projectId: 'project-1',
      parentSummaryId: null,
      scopeType: SUMMARY_SCOPE.SCENE,
      scopeId: 'scene-1',
      title: 'Summary title',
      content: 'Summary content',
      source: 'ai_generated',
      sourceContentHash: 'hash-1',
      provider: 'provider',
      model: 'model',
      isDirty: false,
      tokenCount: 10,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function jobRecord(): SummaryJobRecord {
    return {
      id: 'job-1',
      projectId: 'project-1',
      scopeType: SUMMARY_SCOPE.SCENE,
      scopeId: 'scene-1',
      inputHash: 'hash-1',
      status: 'QUEUED',
      progress: 0,
      force: false,
      bullJobId: 'bull-1',
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
  }

  function sceneInputRecord(): Record<string, unknown> {
    return {
      id: 'scene-1',
      chapterId: 'chapter-1',
      title: 'Opening',
      content: { type: 'doc' },
      contentHash: 'scene-hash',
      wordCount: 12,
      chapter: { book: { projectId: 'project-1' } },
    };
  }

  function chapterInputRecord(): Record<string, unknown> {
    return {
      id: 'chapter-1',
      title: 'Chapter',
      book: { projectId: 'project-1' },
      scenes: [
        {
          id: 'scene-1',
          chapterId: 'chapter-1',
          title: 'Opening',
          content: { type: 'doc' },
          contentHash: 'scene-hash',
          wordCount: 12,
        },
      ],
    };
  }
});
