import { CrossChunkAuditService } from '../../../src/system/entity-extraction/cross-chunk-audit.service';

interface CrossChunkAuditTestContext {
  service: CrossChunkAuditService;
  prisma: {
    scene: { findFirst: jest.Mock };
    chunk: { findMany: jest.Mock };
    entity: { findMany: jest.Mock };
    entityProposal: { findMany: jest.Mock };
  };
  extractionClient: { auditAdjacentChunks: jest.Mock };
  auditService: {
    createCrossChunkContinuityAlert: jest.Mock;
    obsoleteCrossChunkAlertsForChunks: jest.Mock;
    obsoleteRuleAlertsForScene: jest.Mock;
  };
}

describe('CrossChunkAuditService', () => {
  const createService = (): CrossChunkAuditTestContext => {
    const prisma = {
      scene: { findFirst: jest.fn() },
      chunk: { findMany: jest.fn() },
      entity: { findMany: jest.fn() },
      entityProposal: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const extractionClient = {
      auditAdjacentChunks: jest.fn().mockResolvedValue([]),
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
});
