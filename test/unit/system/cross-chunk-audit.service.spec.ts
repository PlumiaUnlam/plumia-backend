import { createHash } from 'node:crypto';
import { CrossChunkAuditService } from '../../../src/system/entity-extraction/cross-chunk-audit.service';
import { CrossChunkAuditMode } from '@prisma/client';

interface CrossChunkAuditTestContext {
  service: CrossChunkAuditService;
  prisma: {
    chunk: { findMany: jest.Mock; findUnique: jest.Mock };
    entity: { findMany: jest.Mock };
    entityProposal: { findMany: jest.Mock };
    scene: { findFirst: jest.Mock; findMany: jest.Mock };
    projectKnowledgeReviewSettings: { findUnique: jest.Mock };
    projectContinuityCheckpoint: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  extractionClient: {
    auditAdjacentChunks: jest.Mock;
    auditSceneChunkGroup: jest.Mock;
    auditSceneAgainstContinuityClaims: jest.Mock;
  };
  auditService: {
    createCrossChunkContinuityAlert: jest.Mock;
    obsoleteCrossChunkAlertsForChunks: jest.Mock;
    obsoleteRuleAlertsForScene: jest.Mock;
    obsoleteCrossChunkAlertsForProject: jest.Mock;
  };
}

describe('CrossChunkAuditService', () => {
  const createService = (): CrossChunkAuditTestContext => {
    const prisma = {
      scene: { findFirst: jest.fn(), findMany: jest.fn() },
      chunk: { findMany: jest.fn(), findUnique: jest.fn() },
      entity: { findMany: jest.fn() },
      entityProposal: { findMany: jest.fn().mockResolvedValue([]) },
      projectKnowledgeReviewSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      projectContinuityCheckpoint: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const extractionClient = {
      auditAdjacentChunks: jest.fn().mockResolvedValue([]),
      auditSceneChunkGroup: jest.fn().mockResolvedValue([]),
      auditSceneAgainstContinuityClaims: jest.fn().mockResolvedValue({
        claims: [],
        contradictions: [],
      }),
    };
    const resolution = {
      normalize: (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
    };
    const auditService = {
      createCrossChunkContinuityAlert: jest.fn(),
      obsoleteCrossChunkAlertsForChunks: jest.fn(),
      obsoleteRuleAlertsForScene: jest.fn(),
      obsoleteCrossChunkAlertsForProject: jest.fn(),
    };
    const temporalSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue(null),
      toExtractionContext: jest.fn(),
    };
    const temporalStates = { createProposal: jest.fn() };

    const service = new CrossChunkAuditService(
      prisma as never,
      extractionClient as never,
      resolution as never,
      auditService as never,
      temporalSnapshotService as never,
      temporalStates as never,
    );

    return {
      service,
      prisma,
      extractionClient,
      auditService,
    };
  };

  it('audits one adjacent pair when a confirmed entity appears in both chunks', async () => {
    const { service, prisma, extractionClient, auditService } = createService();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Elena esta en la torre.',
        contentHash: 'hash-1',
      },
      {
        id: 'chunk-2',
        chunkIndex: 1,
        content: 'Elena esta en el puerto.',
        contentHash: 'hash-2',
      },
    ]);
    prisma.entity.findMany.mockResolvedValue([
      {
        id: 'entity-1',
        canonicalName: 'Elena',
        aliases: [],
        type: 'CHARACTER',
        description: null,
        attributes: {},
      },
    ]);
    extractionClient.auditAdjacentChunks.mockResolvedValue([
      {
        entityName: 'Elena',
        field: 'location',
        firstValue: 'torre',
        secondValue: 'puerto',
        explanation: 'Las ubicaciones son incompatibles.',
        severity: 'HIGH',
        confidenceScore: 0.95,
        firstEvidence: ['Elena esta en la torre.'],
        secondEvidence: ['Elena esta en el puerto.'],
      },
    ]);

    await service.auditScene({
      sceneId: 'scene-1',
      userId: 'user-1',
      onlyDirtyChunkIds: new Set(['chunk-2']),
    });

    expect(extractionClient.auditAdjacentChunks).toHaveBeenCalledTimes(1);
    expect(auditService.createCrossChunkContinuityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: 'scene-1',
        entityId: 'entity-1',
        firstChunkId: 'chunk-1',
        secondChunkId: 'chunk-2',
        firstEvidence: ['Elena esta en la torre.'],
        secondEvidence: ['Elena esta en el puerto.'],
      }),
    );
    expect(auditService.obsoleteCrossChunkAlertsForChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChunkIds: new Set(['chunk-2']),
      }),
    );
  });

  it('audits adjacent pairs even without a shared confirmed entity', async () => {
    const { service, prisma, extractionClient } = createService();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'La torre esta vacia.',
        contentHash: 'hash-1',
      },
      {
        id: 'chunk-2',
        chunkIndex: 1,
        content: 'El puerto esta cerrado.',
        contentHash: 'hash-2',
      },
    ]);
    prisma.entity.findMany.mockResolvedValue([]);

    await service.auditScene({
      sceneId: 'scene-1',
      userId: 'user-1',
    });

    expect(extractionClient.auditAdjacentChunks).toHaveBeenCalledTimes(1);
  });

  it('groups long scenes with overlap and only analyzes groups containing a dirty chunk', async () => {
    const { service, prisma, extractionClient } = createService();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      crossChunkAuditMode: CrossChunkAuditMode.SCENE_GROUPED,
    });
    prisma.chunk.findMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, chunkIndex) => ({
        id: `chunk-${chunkIndex}`,
        chunkIndex,
        content: `Texto ${chunkIndex}`,
        contentHash: `hash-${chunkIndex}`,
      })),
    );
    prisma.entity.findMany.mockResolvedValue([]);

    await service.auditScene({
      sceneId: 'scene-1',
      userId: 'user-1',
      onlyDirtyChunkIds: new Set(['chunk-4']),
    });

    expect(extractionClient.auditSceneChunkGroup).toHaveBeenCalledTimes(2);
    expect(
      extractionClient.auditSceneChunkGroup.mock.calls.map(
        ([call]: [{ chunks: Array<{ chunkIndex: number }> }]) =>
          call.chunks.map((chunk) => chunk.chunkIndex),
      ),
    ).toEqual([
      [0, 1, 2, 3, 4],
      [4, 5, 6, 7, 8],
    ]);
    expect(extractionClient.auditAdjacentChunks).not.toHaveBeenCalled();
  });

  it('disables cross-chunk model calls while preserving project cleanup', async () => {
    const { service, prisma, extractionClient, auditService } = createService();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      crossChunkAuditMode: CrossChunkAuditMode.DISABLED,
    });
    prisma.chunk.findMany.mockResolvedValue([]);
    prisma.entity.findMany.mockResolvedValue([]);

    await service.auditScene({ sceneId: 'scene-1', userId: 'user-1' });

    expect(extractionClient.auditAdjacentChunks).not.toHaveBeenCalled();
    expect(extractionClient.auditSceneChunkGroup).not.toHaveBeenCalled();
    expect(
      auditService.obsoleteCrossChunkAlertsForProject,
    ).toHaveBeenCalledWith({
      projectId: 'project-1',
    });
  });

  it('stores a source-linked checkpoint with only evidence quoted in current chunks', async () => {
    const { service, prisma, extractionClient } = createService();
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-1',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      crossChunkAuditMode: CrossChunkAuditMode.PROJECT_SUMMARY,
    });
    const chunks = [
      {
        id: 'chunk-1',
        chunkIndex: 0,
        content: 'Elena vive en la torre.',
        contentHash: 'hash-1',
      },
    ];
    prisma.chunk.findMany.mockResolvedValue(chunks);
    prisma.entity.findMany.mockResolvedValue([]);
    prisma.scene.findMany.mockResolvedValue([
      {
        id: 'scene-1',
        title: 'La torre',
        order: 1,
        sortKey: '001',
        chapter: { sortKey: '001', book: { sortKey: '001' } },
        chunks,
      },
    ]);
    extractionClient.auditSceneAgainstContinuityClaims.mockResolvedValue({
      claims: [
        {
          entityName: 'Elena',
          field: 'ubicación',
          value: 'torre',
          chunkIndex: 0,
          evidence: 'Elena vive en la torre.',
        },
        {
          entityName: 'Elena',
          field: 'poder',
          value: 'invisible',
          chunkIndex: 0,
          evidence: 'Esta cita no aparece en el chunk.',
        },
      ],
      contradictions: [],
    });

    await service.auditScene({ sceneId: 'scene-1', userId: 'user-1' });

    expect(prisma.projectContinuityCheckpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          projectId: 'project-1',
          sceneId: 'scene-1',
          claims: [
            expect.objectContaining({
              entityName: 'Elena',
              chunkId: 'chunk-1',
              chunkHash: 'hash-1',
              evidence: 'Elena vive en la torre.',
            }) as unknown,
          ],
          isValid: true,
        }) as unknown,
      }),
    );
  });

  it('creates an inter-scene alert only from a current checkpoint quote and current chunk quote', async () => {
    const { service, prisma, extractionClient, auditService } = createService();
    const previous = {
      id: 'chunk-previous',
      chunkIndex: 0,
      content: 'Elena vive en la torre.',
      contentHash: 'hash-previous',
    };
    const current = {
      id: 'chunk-current',
      chunkIndex: 0,
      content: 'Elena vive en el puerto.',
      contentHash: 'hash-current',
    };
    prisma.scene.findFirst.mockResolvedValue({
      id: 'scene-current',
      chapter: { book: { projectId: 'project-1' } },
    });
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      crossChunkAuditMode: CrossChunkAuditMode.PROJECT_SUMMARY,
    });
    prisma.chunk.findMany.mockImplementation(
      (args: { where: { sceneId?: string; id?: { in: string[] } } }) => {
        if (args.where.id) {
          return Promise.resolve(
            [previous, current].filter((chunk) =>
              args.where.id!.in.includes(chunk.id),
            ),
          );
        }
        return Promise.resolve(
          args.where.sceneId ? [current] : [previous, current],
        );
      },
    );
    prisma.chunk.findUnique.mockResolvedValue({ content: previous.content });
    prisma.entity.findMany.mockResolvedValue([
      {
        id: 'entity-elena',
        canonicalName: 'Elena',
        aliases: [],
        type: 'CHARACTER',
        description: null,
        attributes: {},
      },
    ]);
    prisma.scene.findMany.mockResolvedValue([
      {
        id: 'scene-previous',
        title: 'La torre',
        order: 1,
        sortKey: '001',
        chapter: { sortKey: '001', book: { sortKey: '001' } },
        chunks: [previous],
      },
      {
        id: 'scene-current',
        title: 'El puerto',
        order: 2,
        sortKey: '002',
        chapter: { sortKey: '001', book: { sortKey: '001' } },
        chunks: [current],
      },
    ]);
    prisma.projectContinuityCheckpoint.findMany.mockResolvedValue([
      {
        sceneId: 'scene-previous',
        sourceHash: createHash('sha256')
          .update('0:hash-previous')
          .digest('hex'),
        claims: [
          {
            entityName: 'Elena',
            field: 'ubicación',
            value: 'torre',
            sceneId: 'scene-previous',
            chunkId: previous.id,
            chunkHash: previous.contentHash,
            chunkIndex: previous.chunkIndex,
            evidence: previous.content,
          },
        ],
      },
    ]);
    extractionClient.auditSceneAgainstContinuityClaims.mockResolvedValue({
      claims: [],
      contradictions: [
        {
          entityName: 'Elena',
          field: 'ubicación',
          previousClaimIndex: 0,
          currentChunkIndex: 0,
          previousValue: 'torre',
          currentValue: 'puerto',
          explanation: 'La escena ubica a Elena en un lugar incompatible.',
          severity: 'HIGH',
          confidenceScore: 0.97,
          currentEvidence: current.content,
        },
      ],
    });

    await service.auditScene({ sceneId: 'scene-current', userId: 'user-1' });

    expect(auditService.createCrossChunkContinuityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: 'scene-current',
        firstChunkId: previous.id,
        firstSceneId: 'scene-previous',
        secondChunkId: current.id,
        secondSceneId: 'scene-current',
        ruleCode: 'CROSS_SCENE_CONTRADICTION',
        firstEvidence: [previous.content],
        secondEvidence: [current.content],
      }),
    );
  });
});
