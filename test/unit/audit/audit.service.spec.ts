import { Test, type TestingModule } from '@nestjs/testing';
import {
  AuditCategory,
  AuditLevel,
  AuditSeverity,
  AuditStatus,
  Prisma,
} from '@prisma/client';
import {
  AuditService,
  type EntityContinuityAlertInput,
} from '../../../src/audit/audit.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

interface MockPrismaService {
  $transaction: jest.Mock;
  auditAlert: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
  };
  auditFalsePositive: {
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  chunk: {
    findMany: jest.Mock;
  };
}

const alertInput: EntityContinuityAlertInput = {
  projectId: 'project-1',
  sceneId: 'scene-1',
  sourceChunkId: 'chunk-1',
  sourceChunkHash: 'chunk-hash',
  fingerprint: 'fingerprint-1',
  entityId: 'entity-1',
  entityName: 'Elena',
  field: 'estado',
  currentValue: 'Elena esta muerta.',
  observedValue: 'Elena corre hacia la torre.',
  explanation: 'La accion parece incompatible con el estado establecido.',
  evidence: ['Elena corre hacia la torre.'],
  confidence: 0.92,
  severity: AuditSeverity.HIGH,
};

describe('AuditService', () => {
  let service: AuditService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(
              (callback: (tx: MockPrismaService) => unknown) =>
                callback(prisma),
            ),
            auditAlert: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              updateMany: jest.fn(),
              findFirst: jest.fn(),
            },
            auditFalsePositive: {
              findFirst: jest.fn(),
              create: jest.fn(),
              deleteMany: jest.fn(),
            },
            chunk: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
      ],
    }).compile();

    service = module.get(AuditService);
    prisma = module.get<MockPrismaService>(PrismaService);
    prisma.auditAlert.findMany.mockResolvedValue([]);
    prisma.auditFalsePositive.findFirst.mockResolvedValue(null);
  });

  it('creates an active continuity alert with the compared values', async () => {
    prisma.auditAlert.findUnique.mockResolvedValue(null);

    await service.createEntityContinuityAlert(alertInput);

    expect(prisma.auditAlert.create).toHaveBeenCalledTimes(1);
  });

  it('does not create an alert matching a stored author suppression', async () => {
    prisma.auditFalsePositive.findFirst.mockResolvedValue({ id: 'fp-1' });

    await service.createEntityContinuityAlert(alertInput);

    expect(prisma.auditAlert.create).not.toHaveBeenCalled();
    expect(prisma.auditAlert.update).not.toHaveBeenCalled();
  });

  it('merges new citations when the same conflict is detected again', async () => {
    prisma.auditAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: AuditStatus.ACTIVE,
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Elena',
        field: 'estado',
        currentValue: 'Elena esta muerta.',
        observedValue: 'Elena corre hacia la torre.',
        evidence: ['Cita anterior.'],
      },
    });

    await service.createEntityContinuityAlert({
      ...alertInput,
      evidence: ['Cita nueva.'],
    });

    const updateCalls = prisma.auditAlert.update.mock.calls as unknown as Array<
      [
        {
          data: { sourceConflict: { evidence: string[] } };
        },
      ]
    >;
    const updateArgs = updateCalls[0]?.[0];
    expect(updateArgs?.data.sourceConflict.evidence).toEqual([
      'Cita anterior.',
      'Cita nueva.',
    ]);
  });

  it('persists rejection suppression independently of evidence hash and quote', async () => {
    let storedPattern: string | undefined;
    prisma.auditFalsePositive.create.mockImplementation(
      (args: { data: { incorrectPattern: string } }) => {
        storedPattern = args.data.incorrectPattern;
        return Promise.resolve({ id: 'fp-1' });
      },
    );
    prisma.auditAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      ruleCode: 'ENTITY_CONTRADICTION',
      title: 'Contradicción de Elena',
      explanation: alertInput.explanation,
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Elena',
        field: 'estado',
        currentValue: alertInput.currentValue,
        observedValue: alertInput.observedValue,
        evidence: ['cita original'],
        sourceChunkHash: 'old-hash',
      },
    });
    prisma.auditAlert.update.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      detectionLevel: AuditLevel.INTER_SCENE,
      severity: AuditSeverity.HIGH,
      category: AuditCategory.CONTINUITY,
      title: 'Contradicción de Elena',
      description: 'Descripción',
      explanation: alertInput.explanation,
      confidence: new Prisma.Decimal('0.92'),
      status: AuditStatus.DISMISSED,
      createdAt: new Date(),
      resolvedAt: new Date(),
      sourceConflict: {},
    });

    await service.updateStatus('user-1', 'alert-1', AuditStatus.DISMISSED);
    expect(storedPattern).toContain('scene-1');

    prisma.auditFalsePositive.findFirst.mockResolvedValue({ id: 'fp-1' });
    await service.createEntityContinuityAlert({
      ...alertInput,
      sourceChunkHash: 'new-hash',
      evidence: ['cita reformulada'],
    });
    expect(prisma.auditAlert.create).not.toHaveBeenCalled();
  });

  it('reopens a resolved conflict when a later analysis detects it again', async () => {
    let updatedAlert: { data: Record<string, unknown> } | undefined;
    prisma.auditAlert.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => {
        updatedAlert = args;
        return Promise.resolve({});
      },
    );
    prisma.auditAlert.findUnique.mockResolvedValue(null);
    prisma.auditAlert.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'resolved-alert',
        sourceConflict: {
          entityId: 'entity-1',
          entityName: 'Elena',
          field: 'estado',
          currentValue: 'Elena esta muerta.',
          observedValue: 'Elena corre hacia la torre.',
          evidence: ['cita anterior'],
        },
      },
    ]);

    await service.createEntityContinuityAlert({
      ...alertInput,
      fingerprint: 'new-fingerprint-after-edit',
      sourceChunkHash: 'new-hash',
      evidence: ['cita reformulada'],
    });

    expect(updatedAlert?.data['status']).toBe(AuditStatus.ACTIVE);
    expect(updatedAlert?.data['fingerprint']).toBe(
      'new-fingerprint-after-edit',
    );
    expect(updatedAlert?.data['resolvedAt']).toBeNull();
  });

  it('allows a dismissed conflict with different values to be created', async () => {
    prisma.auditAlert.findUnique.mockResolvedValue(null);
    prisma.auditFalsePositive.findFirst.mockResolvedValue(null);
    prisma.auditAlert.findMany.mockResolvedValue([]);

    await service.createEntityContinuityAlert({
      ...alertInput,
      currentValue: 'Elena esta viva.',
    });

    expect(prisma.auditAlert.create).toHaveBeenCalledTimes(1);
  });

  it('marks alerts obsolete when their chunk has no remaining text', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      {
        id: 'alert-stale',
        fingerprint: 'old-fingerprint',
        sourceConflict: {
          entityId: 'entity-1',
          entityName: 'Elena',
          field: 'estado',
          currentValue: 'Muerta',
          observedValue: 'Actua',
          evidence: [],
          sourceChunkId: 'chunk-1',
        },
      },
    ]);

    await service.obsoleteAlertsForEmptyChunk({
      projectId: 'project-1',
      sourceChunkId: 'chunk-1',
    });

    expect(prisma.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['alert-stale'] } },
      data: { status: AuditStatus.OBSOLETE },
    });
  });

  it('marks an alert obsolete when its source chunk hash is no longer current', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      {
        id: 'alert-stale-hash',
        sceneId: 'scene-1',
        sourceChunkId: 'chunk-1',
        sourceChunkHash: 'old-hash',
        sourceConflict: {},
      },
    ]);
    prisma.chunk.findMany.mockResolvedValue([
      { id: 'chunk-1', sceneId: 'scene-1' },
    ]);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunks: new Map([['chunk-1', { contentHash: 'new-hash' }]]),
    });

    expect(prisma.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['alert-stale-hash'] } },
      data: { status: AuditStatus.OBSOLETE },
    });
  });

  it('keeps an alert when another analysis omits it and its citation is unchanged', async () => {
    prisma.auditAlert.findMany.mockResolvedValue([
      {
        id: 'alert-current',
        sceneId: 'scene-1',
        sourceChunkId: 'chunk-1',
        sourceChunkHash: 'same-hash',
        sourceConflict: {},
      },
    ]);
    prisma.chunk.findMany.mockResolvedValue([
      { id: 'chunk-1', sceneId: 'scene-1' },
    ]);

    await service.obsoleteAlertsWithoutCurrentChunkSupport({
      projectId: 'project-1',
      sceneId: 'scene-1',
      chunks: new Map([['chunk-1', { contentHash: 'same-hash' }]]),
    });

    expect(prisma.auditAlert.updateMany).not.toHaveBeenCalled();
  });

  it('resolves an authorized alert without changing its conflict data', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    prisma.auditAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      ruleCode: 'ENTITY_CONTRADICTION',
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Elena',
        field: 'estado',
        currentValue: 'Muerta',
        observedValue: 'Actua',
        evidence: ['Elena actua.'],
      },
    });
    prisma.auditAlert.update.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      detectionLevel: AuditLevel.INTER_SCENE,
      severity: AuditSeverity.HIGH,
      category: AuditCategory.CONTINUITY,
      title: 'Posible contradiccion: Elena',
      description: 'Descripcion',
      explanation: 'Explicacion',
      confidence: new Prisma.Decimal('0.92'),
      status: AuditStatus.RESOLVED,
      createdAt: now,
      resolvedAt: now,
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Elena',
        field: 'estado',
        currentValue: 'Muerta',
        observedValue: 'Actua',
        evidence: ['Elena actua.'],
      },
    });

    const result = await service.updateStatus(
      'user-1',
      'alert-1',
      AuditStatus.RESOLVED,
    );

    expect(prisma.auditAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: {
        status: AuditStatus.RESOLVED,
        resolvedById: 'user-1',
        resolvedAt: expect.any(Date) as unknown,
      },
    });
    expect(result.conflict?.entityId).toBe('entity-1');
    expect(result.status).toBe(AuditStatus.RESOLVED);
  });

  it('restores a dismissed alert and removes its suppression', async () => {
    let deletedSuppression:
      | {
          where: { projectId: string; incorrectPattern: string };
        }
      | undefined;
    prisma.auditFalsePositive.deleteMany.mockImplementation(
      (args: { where: { projectId: string; incorrectPattern: string } }) => {
        deletedSuppression = args;
        return Promise.resolve({ count: 1 });
      },
    );
    const now = new Date('2026-08-21T12:00:00.000Z');
    prisma.auditAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      ruleCode: 'ENTITY_CONTRADICTION',
      sourceConflict: {
        entityId: 'entity-1',
        entityName: 'Elena',
        field: 'estado',
        currentValue: 'Muerta',
        observedValue: 'Actua',
        evidence: ['Elena actua.'],
      },
    });
    prisma.auditAlert.update.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      detectionLevel: AuditLevel.INTER_SCENE,
      severity: AuditSeverity.HIGH,
      category: AuditCategory.CONTINUITY,
      title: 'Posible contradiccion: Elena',
      description: 'Descripcion',
      explanation: 'Explicacion',
      confidence: new Prisma.Decimal('0.92'),
      status: AuditStatus.ACTIVE,
      createdAt: now,
      resolvedAt: null,
      sourceConflict: {},
    });

    const result = await service.updateStatus(
      'user-1',
      'alert-1',
      AuditStatus.ACTIVE,
    );

    expect(deletedSuppression?.where.projectId).toBe('project-1');
    expect(deletedSuppression?.where.incorrectPattern).toContain('scene-1');
    expect(result.status).toBe(AuditStatus.ACTIVE);
    expect(result.resolvedAt).toBeNull();
  });
});
