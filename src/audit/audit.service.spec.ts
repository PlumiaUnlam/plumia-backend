import { AuditService } from './audit.service';

describe('AuditService evidence scene mapping', () => {
  it('resolves scene ids from supporting chunks when stored metadata is incomplete', async () => {
    const alert = {
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-3',
      detectionLevel: 'INTER_SCENE',
      severity: 'MEDIUM',
      category: 'CONTINUITY',
      ruleCode: 'CROSS_SCENE_CONTRADICTION',
      sourceChunkId: 'chunk-scene-1',
      sourceChunkHash: 'hash-1',
      title: 'Posible contradiccion',
      description: null,
      explanation: 'Los textos parecen incompatibles.',
      confidence: 0.9,
      status: 'ACTIVE',
      createdAt: new Date('2026-10-28T12:00:00Z'),
      resolvedAt: null,
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Alicia',
        field: 'relacion',
        currentValue: 'Se enfrentaron.',
        observedValue: 'Nunca se conocieron.',
        evidence: ['Nunca se conocieron.'],
        supportingChunks: [
          {
            chunkId: 'chunk-scene-1',
            chunkHash: 'hash-1',
            chunkIndex: 0,
            side: 'first',
            evidence: ['Se enfrentaron en el puente.'],
          },
          {
            chunkId: 'chunk-scene-3',
            chunkHash: 'hash-3',
            chunkIndex: 0,
            sceneId: 'scene-3',
            side: 'second',
            evidence: ['Nunca se conocieron.'],
          },
        ],
      },
    };
    const prisma = {
      auditAlert: { findMany: jest.fn().mockResolvedValue([alert]) },
      chunk: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'chunk-scene-1', sceneId: 'scene-1' }]),
      },
    };
    const service = new AuditService(prisma as never);

    const result = await service.listByProject('user-1', 'project-1');

    expect(result[0]?.conflict?.supportingEvidence).toEqual([
      {
        side: 'first',
        quote: 'Se enfrentaron en el puente.',
        sceneId: 'scene-1',
      },
      {
        side: 'second',
        quote: 'Nunca se conocieron.',
        sceneId: 'scene-3',
      },
    ]);
    expect(prisma.chunk.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['chunk-scene-1', 'chunk-scene-3'] } },
      select: { id: true, sceneId: true },
    });
  });
});

describe('AuditService alert evidence reconciliation', () => {
  const alertWithEvidence = {
    id: 'alert-1',
    projectId: 'project-1',
    sceneId: 'scene-2',
    sourceChunkId: 'chunk-2',
    sourceChunkHash: 'hash-2',
    sourceConflict: {
      entityId: 'entity-1',
      entityName: 'Alicia',
      field: 'location',
      currentValue: 'La torre',
      observedValue: 'El puerto',
      evidence: ['Alicia llegó al puerto.'],
      supportingChunks: [
        {
          chunkId: 'chunk-1',
          chunkHash: 'hash-1',
          chunkIndex: 0,
          sceneId: 'scene-1',
          side: 'first',
          evidence: ['Alicia estaba en la torre.'],
        },
        {
          chunkId: 'chunk-2',
          chunkHash: 'hash-2',
          chunkIndex: 0,
          sceneId: 'scene-2',
          side: 'second',
          evidence: ['Alicia llegó al puerto.'],
        },
      ],
    },
  };

  it('keeps an alert when a repeated analysis omits it but its evidence is unchanged', async () => {
    const prisma = {
      auditAlert: {
        findMany: jest.fn().mockResolvedValue([alertWithEvidence]),
        updateMany: jest.fn(),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'chunk-1', sceneId: 'scene-1' },
          { id: 'chunk-2', sceneId: 'scene-2' },
        ]),
      },
    };
    const service = new AuditService(prisma as never);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-2',
      chunks: new Map([['chunk-2', { contentHash: 'hash-2' }]]),
    });

    expect(prisma.auditAlert.updateMany).not.toHaveBeenCalled();
  });

  it('obsoletes an alert when a supporting chunk hash changes', async () => {
    const prisma = {
      auditAlert: {
        findMany: jest.fn().mockResolvedValue([alertWithEvidence]),
        updateMany: jest.fn(),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'chunk-1', sceneId: 'scene-1' },
          { id: 'chunk-2', sceneId: 'scene-2' },
        ]),
      },
    };
    const service = new AuditService(prisma as never);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-2',
      chunks: new Map([['chunk-2', { contentHash: 'changed-hash' }]]),
    });

    expect(prisma.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['alert-1'] } },
      data: { status: 'OBSOLETE' },
    });
  });

  it('does not treat evidence from another scene as missing', async () => {
    const prisma = {
      auditAlert: {
        findMany: jest.fn().mockResolvedValue([alertWithEvidence]),
        updateMany: jest.fn(),
      },
      chunk: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'chunk-1', sceneId: 'scene-1' },
          { id: 'chunk-2', sceneId: 'scene-2' },
        ]),
      },
    };
    const service = new AuditService(prisma as never);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunks: new Map([['chunk-1', { contentHash: 'hash-1' }]]),
    });

    expect(prisma.auditAlert.updateMany).not.toHaveBeenCalled();
  });

  it('obsoletes a same-scene alert when a cited chunk was deleted', async () => {
    const alert = {
      ...alertWithEvidence,
      ruleCode: 'INTRA_SCENE_CONTRADICTION',
      sourceConflict: {
        ...alertWithEvidence.sourceConflict,
        supportingChunks: alertWithEvidence.sourceConflict.supportingChunks.map(
          (source) => ({ ...source, sceneId: undefined }),
        ),
      },
    };
    const prisma = {
      auditAlert: {
        findMany: jest.fn().mockResolvedValue([alert]),
        updateMany: jest.fn(),
      },
      chunk: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'chunk-1', sceneId: 'scene-2' }]),
      },
    };
    const service = new AuditService(prisma as never);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-2',
      chunks: new Map([['chunk-1', { contentHash: 'hash-1' }]]),
    });

    expect(prisma.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['alert-1'] } },
      data: { status: 'OBSOLETE' },
    });
  });
});
