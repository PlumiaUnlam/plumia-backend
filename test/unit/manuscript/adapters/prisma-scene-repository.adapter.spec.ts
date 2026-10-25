import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { createContentHash } from '../../../../src/manuscript/domain/json-content';
import { SceneStatus } from '../../../../src/manuscript/domain/scene-status';
import { PrismaSceneRepository } from '../../../../src/manuscript/adapters/prisma-scene-repository.adapter';
import { type SceneRecord } from '../../../../src/manuscript/ports/scene-repository.port';

interface MockPrismaService {
  chapter: {
    findFirst: jest.Mock;
  };
  scene: {
    aggregate: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('PrismaSceneRepository', () => {
  let repository: PrismaSceneRepository;
  let prisma: MockPrismaService;

  const now = new Date('2026-06-09T00:00:00.000Z');
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
  };
  const scene: SceneRecord = {
    id: 'scene-1',
    chapterId: 'chapter-1',
    title: 'Opening',
    sortKey: '001',
    content,
    contentHash: createContentHash(content),
    wordCount: 1,
    povCharacterId: null,
    status: SceneStatus.DRAFT,
    order: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaSceneRepository,
        {
          provide: PrismaService,
          useValue: {
            chapter: { findFirst: jest.fn() },
            scene: {
              aggregate: jest.fn(),
              create: jest.fn(),
              findFirst: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    repository = module.get(PrismaSceneRepository);
    prisma = module.get<MockPrismaService>(PrismaService);
  });

  it('creates a scene with a content hash when content is provided', async () => {
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'chapter-1',
      book: { projectId: 'project-1' },
    });
    prisma.scene.aggregate.mockResolvedValue({ _max: { order: 2 } });
    const tx = {
      scene: {
        create: jest.fn().mockResolvedValue(scene),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof tx) => Promise<SceneRecord | null>,
      ) => callback(tx),
    );

    const result = await repository.createForUser('user-1', {
      chapterId: 'chapter-1',
      title: 'Opening',
      sortKey: '001',
      content,
      wordCount: 1,
    });

    expect(result).toEqual(scene);
    expect(tx.scene.create).toHaveBeenCalledWith({
      data: {
        chapterId: 'chapter-1',
        sortKey: '001',
        title: 'Opening',
        content,
        contentHash: createContentHash(content),
        wordCount: 1,
        order: 3,
      },
    });
    expect(tx.chunk.findMany).toHaveBeenCalledWith({
      where: { sceneId: 'scene-1' },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        contentHash: true,
        tokenCount: true,
        isDirty: true,
      },
    });
  });

  it('updates content and writes outbox in one transaction', async () => {
    const existing: SceneRecord = { ...scene, contentHash: 'stale-hash' };
    const tx = {
      scene: {
        update: jest.fn().mockResolvedValue(scene),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce({
            chapter: { book: { projectId: 'project-1' } },
          }),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      outbox: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: true,
        }),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (
          transaction: typeof tx,
        ) => Promise<{ scene: SceneRecord; contentChanged: boolean } | null>,
      ) => callback(tx),
    );

    const result = await repository.updateContentForUser('user-1', 'scene-1', {
      content,
      wordCount: 1,
    });

    expect(result).toEqual({
      scene,
      contentChanged: true,
      previousWordCount: existing.wordCount,
      analysisStatus: 'QUEUED',
    });
    expect(tx.scene.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'scene-1',
        deletedAt: null,
        chapter: { book: { project: { userId: 'user-1' } } },
      },
    });
    expect(tx.scene.update).toHaveBeenCalledWith({
      where: { id: 'scene-1' },
      data: {
        content,
        contentHash: createContentHash(content),
        wordCount: 1,
      },
    });
    expect(tx.chunk.findMany).toHaveBeenCalled();
    expect(tx.outbox.create).toHaveBeenCalledWith({
      data: {
        aggregateType: 'Scene',
        aggregateId: 'scene-1',
        eventType: 'scene_changed',
        payload: {
          sceneId: 'scene-1',
          chapterId: 'chapter-1',
          contentHash: createContentHash(content),
          wordCount: 1,
          userId: 'user-1',
          trigger: 'AUTO_SAVE',
        },
        createdAt: expect.any(Date) as unknown,
      },
    });
  });

  it('reconciles every scene when a narrative order changes', async () => {
    const reorderedScene = { ...scene, sortKey: '002' };
    const tx = {
      scene: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scene-1',
          sortKey: '001',
          order: 0,
          chapter: { book: { projectId: 'project-1' } },
        }),
        update: jest.fn().mockResolvedValue(reorderedScene),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'scene-1' }, { id: 'scene-2' }]),
      },
      outbox: { createMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof tx) => Promise<SceneRecord | null>,
      ) => callback(tx),
    );

    await expect(
      repository.updateForUser('user-1', 'scene-1', { sortKey: '002' }),
    ).resolves.toEqual(reorderedScene);

    expect(tx.outbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          aggregateId: 'scene-1',
          eventType: 'scene_temporal_audit',
        }) as unknown,
        expect.objectContaining({
          aggregateId: 'scene-2',
          eventType: 'scene_temporal_audit',
        }) as unknown,
      ],
    });
  });

  it('saves changes without creating an analysis event when automatic analysis is disabled', async () => {
    const existing: SceneRecord = { ...scene, contentHash: 'stale-hash' };
    const tx = {
      scene: {
        update: jest.fn().mockResolvedValue(scene),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce({
            chapter: { book: { projectId: 'project-1' } },
          }),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: false,
        }),
      },
      outbox: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    await expect(
      repository.updateContentForUser('user-1', 'scene-1', {
        content,
        wordCount: 1,
      }),
    ).resolves.toMatchObject({
      contentChanged: true,
      analysisStatus: 'NOT_REQUESTED',
    });
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('queues manual analysis for dirty chunks and deduplicates a pending event', async () => {
    const tx = {
      scene: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scene-1',
          chapterId: 'chapter-1',
          contentHash: 'hash-1',
          wordCount: 10,
        }),
      },
      chunk: { count: jest.fn().mockResolvedValue(2) },
      outbox: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            payload: { contentHash: 'hash-1' },
          })
          .mockResolvedValueOnce({
            payload: { contentHash: 'hash-1' },
          }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    await expect(
      repository.requestAnalysisForUser('user-1', 'scene-1'),
    ).resolves.toEqual({ status: 'QUEUED', pendingChunks: 2 });
    expect(tx.outbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'scene_changed',
        payload: expect.objectContaining({ trigger: 'MANUAL' }) as unknown,
      }) as unknown,
    });

    await expect(
      repository.requestAnalysisForUser('user-1', 'scene-1'),
    ).resolves.toEqual({ status: 'ALREADY_QUEUED', pendingChunks: 2 });
    expect(tx.outbox.create).toHaveBeenCalledTimes(1);
  });

  it('reports no changes when manual analysis has no dirty chunks', async () => {
    const tx = {
      scene: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'scene-1',
          chapterId: 'chapter-1',
          contentHash: 'hash-1',
          wordCount: 10,
        }),
      },
      chunk: { count: jest.fn().mockResolvedValue(0) },
      outbox: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    await expect(
      repository.requestAnalysisForUser('user-1', 'scene-1'),
    ).resolves.toEqual({ status: 'NO_CHANGES', pendingChunks: 0 });
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('does not write outbox when the scene is not owned by the user', async () => {
    const tx = {
      scene: {
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      outbox: {
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (
          transaction: typeof tx,
        ) => Promise<{ scene: SceneRecord; contentChanged: boolean } | null>,
      ) => callback(tx),
    );

    const result = await repository.updateContentForUser('user-1', 'missing', {
      content,
    });

    expect(result).toBeNull();
    expect(tx.scene.update).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('does not write outbox when the content is unchanged', async () => {
    const tx = {
      scene: {
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(scene),
      },
      outbox: {
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (
          transaction: typeof tx,
        ) => Promise<{ scene: SceneRecord; contentChanged: boolean } | null>,
      ) => callback(tx),
    );

    const result = await repository.updateContentForUser('user-1', 'scene-1', {
      content,
    });

    expect(result).toEqual({
      scene,
      contentChanged: false,
      previousWordCount: scene.wordCount,
      analysisStatus: 'NOT_REQUESTED',
    });
    expect(tx.scene.update).not.toHaveBeenCalled();
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });

  it('translates prisma conflicts thrown by the content update transaction', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      repository.updateContentForUser('user-1', 'scene-1', {
        content,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
