import type { Scene as PrismaScene } from '@prisma/client';
import { PrismaStaleChunkStore } from '../../src/chat/adapters/prisma-stale-chunk-store.adapter';
import { PgVectorStore } from '../../src/chat/adapters/pg-vector-store.adapter';
import { PgEntitySearch } from '../../src/knowledge/adapters/pg-entity-search.adapter';
import {
  countActiveEntitiesForProject,
  findProjectForUser,
} from '../../src/knowledge/adapters/prisma-knowledge-access';
import { SceneStatus } from '../../src/manuscript/domain/scene-status';
import {
  toSceneRecord,
  toSceneVersionRecord,
} from '../../src/manuscript/adapters/scene-record.mapper';
import { PrismaExportSourceAdapter } from '../../src/publishing/exports/adapters/prisma-export-source.adapter';
import { PrismaStorageResourceAuthorization } from '../../src/storage/adapters/prisma-storage-resource-authorization.adapter';

describe('Prisma and Postgres adapters', () => {
  it('inserts and updates chunk embeddings with serialized vectors', async () => {
    const prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const store = new PgVectorStore(prisma as never);

    await expect(
      store.upsertChunk({
        projectId: 'project-1',
        sceneId: 'scene-1',
        content: 'Text',
        embedding: [0.1, -0.2],
        tokenCount: 2,
        chunkIndex: 0,
        contentHash: 'content-hash',
        model: 'embedding-v2',
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.upsertChunk({
        projectId: 'project-1',
        sceneId: 'scene-1',
        content: 'Legacy text',
        embedding: [],
        tokenCount: 2,
        chunkIndex: 1,
        model: 'embedding-v2',
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.updateChunkEmbedding({
        chunkId: 'chunk-1',
        embedding: [0.5],
        contentHash: 'content-hash',
        model: 'embedding-v2',
      }),
    ).resolves.toBeUndefined();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('searches only chunks with matching project, model, and source hash', async () => {
    const matches = [
      {
        chunkId: 'chunk-1',
        sceneId: 'scene-1',
        content: 'Text',
        distance: 0.15,
      },
    ];
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(matches) };
    const store = new PgVectorStore(prisma as never);

    await expect(
      store.search({
        projectId: 'project-1',
        embedding: [0.1, 0.2],
        model: 'embedding-v2',
        limit: 8,
      }),
    ).resolves.toEqual(matches);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('queries stale chunks for the selected project, embedding model, and batch size', async () => {
    const staleChunks = [
      { id: 'chunk-1', content: 'A paragraph', contentHash: 'hash-1' },
    ];
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(staleChunks) };
    const store = new PrismaStaleChunkStore(prisma as never);

    await expect(
      store.findStaleChunks('project-1', 'embedding-v2', 20),
    ).resolves.toEqual(staleChunks);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the default and explicit trigram thresholds for entity search', async () => {
    const results = [
      { entityId: 'entity-1', canonicalName: 'Mara', score: 0.82 },
    ];
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(results) };
    const search = new PgEntitySearch(prisma as never);

    await expect(
      search.searchByName({ projectId: 'project-1', query: 'Mar', limit: 10 }),
    ).resolves.toEqual(results);
    await expect(
      search.searchByName({
        projectId: 'project-1',
        query: 'Mar',
        limit: 5,
        threshold: 0.6,
      }),
    ).resolves.toEqual(results);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('scopes project and entity queries to active records', async () => {
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
      entity: { count: jest.fn().mockResolvedValue(2) },
    };

    await expect(
      findProjectForUser(prisma as never, 'user-1', 'project-1'),
    ).resolves.toEqual({ id: 'project-1' });
    await expect(
      countActiveEntitiesForProject(prisma as never, 'project-1', [
        'entity-1',
        'entity-2',
      ]),
    ).resolves.toBe(2);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.entity.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['entity-1', 'entity-2'] },
        projectId: 'project-1',
        deletedAt: null,
      },
    });
  });

  it('authorizes active storyboard cards and rejects missing or deleted cards', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'card-1' });
    const authorization = new PrismaStorageResourceAuthorization({
      storyboardNote: { findFirst },
    } as never);

    await expect(
      authorization.hasStoryboardCardAccess('user-1', 'card-1'),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'card-1',
        deletedAt: null,
        project: { userId: 'user-1', deletedAt: null },
      },
      select: { id: true },
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(
      authorization.hasStoryboardCardAccess('user-1', 'missing'),
    ).resolves.toBe(false);
  });

  it('maps scene records and falls back to draft for an unknown persisted status', () => {
    const scene = {
      id: 'scene-1',
      chapterId: 'chapter-1',
      title: 'Opening',
      sortKey: '001',
      content: { type: 'doc' },
      contentHash: 'hash-1',
      wordCount: 12,
      povCharacterId: null,
      status: 'IN_PROGRESS',
      order: 2,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      deletedAt: null,
    } as unknown as PrismaScene;

    expect(toSceneRecord(scene)).toMatchObject({
      id: 'scene-1',
      chapterId: 'chapter-1',
      contentHash: 'hash-1',
      status: SceneStatus.IN_PROGRESS,
      order: 2,
    });
    expect(
      toSceneRecord({ ...scene, status: 'UNKNOWN' } as unknown as PrismaScene)
        .status,
    ).toBe(SceneStatus.DRAFT);
  });

  it('maps scene version rows and retrieves export sources only for active owned books', async () => {
    const versionDate = new Date('2026-09-03T00:00:00.000Z');
    expect(
      toSceneVersionRecord({
        id: 'version-1',
        sceneId: 'scene-1',
        label: null,
        content: null,
        contentHash: null,
        wordCount: 0,
        createdFromId: null,
        createdAt: versionDate,
        updatedAt: versionDate,
        deletedAt: null,
      }),
    ).toMatchObject({ id: 'version-1', label: null, contentHash: null });

    const book = { id: 'book-1', title: 'Book', chapters: [] };
    const findFirst = jest.fn().mockResolvedValue(book);
    const adapter = new PrismaExportSourceAdapter({
      book: { findFirst },
    } as never);

    await expect(adapter.findByIdForUser('user-1', 'book-1')).resolves.toBe(
      book,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'book-1',
          deletedAt: null,
          project: { userId: 'user-1', deletedAt: null },
        },
      }),
    );
    findFirst.mockResolvedValueOnce(null);
    await expect(
      adapter.findByIdForUser('user-2', 'book-1'),
    ).resolves.toBeNull();
  });
});
