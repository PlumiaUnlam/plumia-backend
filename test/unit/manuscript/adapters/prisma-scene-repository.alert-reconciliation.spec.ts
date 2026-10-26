import { AuditStatus } from '@prisma/client';
import type { PrismaService } from '../../../../src/prisma/prisma.service';
import { createContentHash } from '../../../../src/manuscript/domain/json-content';
import { PrismaSceneRepository } from '../../../../src/manuscript/adapters/prisma-scene-repository.adapter';
import { SceneStatus } from '../../../../src/manuscript/domain/scene-status';

describe('PrismaSceneRepository alert reconciliation', () => {
  it('obsoletes alerts supported by deleted chunks without running analysis', async () => {
    const emptyContent = { type: 'doc', content: [] };
    const now = new Date('2026-06-09T00:00:00.000Z');
    const updatedScene = {
      id: 'scene-1',
      chapterId: 'chapter-1',
      title: 'Opening',
      sortKey: '001',
      content: emptyContent,
      contentHash: createContentHash(emptyContent),
      wordCount: 0,
      povCharacterId: null,
      status: SceneStatus.DRAFT,
      order: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const tx = {
      scene: {
        update: jest.fn().mockResolvedValue(updatedScene),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'scene-1', contentHash: 'old-hash' })
          .mockResolvedValueOnce({
            chapter: { book: { projectId: 'project-1' } },
          }),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'chunk-1',
            chunkIndex: 0,
            content: 'Elena is in the tower.',
            contentHash: 'chunk-hash-1',
            tokenCount: 5,
            isDirty: false,
          },
          {
            id: 'chunk-2',
            chunkIndex: 1,
            content: 'Elena is in the harbor.',
            contentHash: 'chunk-hash-2',
            tokenCount: 5,
            isDirty: false,
          },
        ]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditAlert: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'single-chunk-alert',
            sourceChunkId: 'chunk-1',
            sourceConflict: {},
          },
          {
            id: 'cross-chunk-alert',
            sourceChunkId: 'chunk-1',
            sourceConflict: {
              supportingChunks: [
                { chunkId: 'chunk-1', chunkHash: 'chunk-hash-1' },
                { chunkId: 'chunk-2', chunkHash: 'chunk-hash-2' },
              ],
            },
          },
        ]),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: false,
        }),
      },
      outbox: { findFirst: jest.fn(), create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    const repository = new PrismaSceneRepository(prisma);

    await expect(
      repository.updateContentForUser('user-1', 'scene-1', {
        content: emptyContent,
        wordCount: 0,
      }),
    ).resolves.toMatchObject({
      contentChanged: true,
      analysisStatus: 'NOT_REQUESTED',
    });

    expect(tx.auditAlert.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['single-chunk-alert', 'cross-chunk-alert'] },
        status: AuditStatus.ACTIVE,
      },
      data: { status: AuditStatus.OBSOLETE },
    });
    expect(tx.outbox.create).not.toHaveBeenCalled();
  });
});
