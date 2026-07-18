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
        callback: (
          transaction: typeof tx,
        ) => Promise<SceneRecord | null>,
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
      wordCount: 1,
    });

    expect(result).toEqual({ scene, contentChanged: true });
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
        },
        createdAt: expect.any(Date) as unknown,
      },
    });
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

    expect(result).toEqual({ scene, contentChanged: false });
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
