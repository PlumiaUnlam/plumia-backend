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
    create: jest.Mock;
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
    prisma.chapter.findFirst.mockResolvedValue({ id: 'chapter-1' });
    prisma.scene.create.mockResolvedValue(scene);

    const result = await repository.createForUser('user-1', {
      chapterId: 'chapter-1',
      title: 'Opening',
      sortKey: '001',
      content,
      wordCount: 1,
    });

    expect(result).toEqual(scene);
    expect(prisma.scene.create).toHaveBeenCalledWith({
      data: {
        chapterId: 'chapter-1',
        sortKey: '001',
        title: 'Opening',
        content,
        contentHash: createContentHash(content),
        wordCount: 1,
      },
    });
  });

  it('updates content and writes outbox in one transaction', async () => {
    const tx = {
      scene: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(scene),
      },
      outbox: {
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof tx) => Promise<SceneRecord | null>,
      ) => callback(tx),
    );

    const result = await repository.updateContentForUser('user-1', 'scene-1', {
      content,
      wordCount: 1,
    });

    expect(result).toEqual(scene);
    expect(tx.scene.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'scene-1',
        deletedAt: null,
        chapter: { book: { project: { userId: 'user-1' } } },
      },
      data: {
        content,
        contentHash: createContentHash(content),
        wordCount: 1,
      },
    });
    expect(tx.outbox.create).toHaveBeenCalledWith({
      data: {
        aggregateType: 'Scene',
        aggregateId: 'scene-1',
        eventType: 'scene.content.updated',
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
      },
      outbox: {
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof tx) => Promise<SceneRecord | null>,
      ) => callback(tx),
    );

    const result = await repository.updateContentForUser('user-1', 'missing', {
      content,
    });

    expect(result).toBeNull();
    expect(tx.scene.findFirst).not.toHaveBeenCalled();
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
