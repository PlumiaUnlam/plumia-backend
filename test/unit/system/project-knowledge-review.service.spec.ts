import { ProjectKnowledgeReviewService } from '../../../src/system/project-knowledge-review.service';

describe('ProjectKnowledgeReviewService', () => {
  const createService = () => {
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
      projectKnowledgeReviewSettings: { upsert: jest.fn() },
      scene: { findMany: jest.fn() },
      knowledgeAnalysisRun: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      outbox: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (transaction: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    return {
      service: new ProjectKnowledgeReviewService(prisma as never),
      prisma,
    };
  };

  it('counts dirty chunks and every adjacent pair affected by one', async () => {
    const { service, prisma } = createService();
    prisma.scene.findMany.mockResolvedValue([
      {
        id: 'scene-1',
        title: 'La travesía',
        order: 1,
        sortKey: '001',
        chapter: {
          title: 'Capítulo uno',
          sortKey: '001',
          book: { title: 'Libro uno', sortKey: '001' },
        },
        chunks: [
          { id: 'chunk-0', chunkIndex: 0, isDirty: true },
          { id: 'chunk-1', chunkIndex: 1, isDirty: false },
          { id: 'chunk-2', chunkIndex: 2, isDirty: true },
          { id: 'chunk-3', chunkIndex: 3, isDirty: false },
        ],
      },
    ]);

    await expect(
      service.previewAnalysis('user-1', 'project-1'),
    ).resolves.toMatchObject({
      projectId: 'project-1',
      sceneCount: 1,
      chunkCount: 2,
      affectedAdjacentPairs: 3,
      scenes: [
        {
          id: 'scene-1',
          title: 'La travesía',
          chapterTitle: 'Capítulo uno',
          bookTitle: 'Libro uno',
          pendingChunks: 2,
        },
      ],
    });
    expect(prisma.scene.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chunks: { some: { isDirty: true } },
        }) as unknown,
        select: expect.objectContaining({
          chunks: expect.objectContaining({
            select: { id: true, chunkIndex: true, isDirty: true },
          }) as unknown,
        }) as unknown,
      }) as unknown,
    );
  });

  it('returns NO_CHANGES without creating a run or outbox event', async () => {
    const { service, prisma } = createService();
    prisma.knowledgeAnalysisRun.findFirst.mockResolvedValue(null);
    prisma.scene.findMany.mockResolvedValue([]);

    await expect(service.startAnalysis('user-1', 'project-1')).resolves.toEqual(
      { status: 'NO_CHANGES', run: null },
    );
    expect(prisma.knowledgeAnalysisRun.create).not.toHaveBeenCalled();
    expect(prisma.outbox.create).not.toHaveBeenCalled();
  });

  it('returns an existing active run instead of enqueueing a duplicate', async () => {
    const { service, prisma } = createService();
    prisma.knowledgeAnalysisRun.findFirst.mockResolvedValue({ id: 'run-1' });
    prisma.knowledgeAnalysisRun.findUniqueOrThrow.mockResolvedValue({
      id: 'run-1',
      projectId: 'project-1',
      status: 'RUNNING',
      totalScenes: 1,
      processedScenes: 0,
      failedScenes: 0,
      totalChunks: 2,
      createdAt: new Date(),
      completedAt: null,
      scenes: [
        {
          sceneId: 'scene-1',
          status: 'RUNNING',
          totalChunks: 2,
          processedChunks: 0,
          error: null,
          scene: {
            title: 'La travesía',
            chapter: { title: 'Capítulo uno', book: { title: 'Libro uno' } },
          },
        },
      ],
    });

    await expect(
      service.startAnalysis('user-1', 'project-1'),
    ).resolves.toMatchObject({
      status: 'ALREADY_QUEUED',
      run: { id: 'run-1' },
    });
    expect(prisma.scene.findMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeAnalysisRun.create).not.toHaveBeenCalled();
    expect(prisma.outbox.create).not.toHaveBeenCalled();
  });
});
