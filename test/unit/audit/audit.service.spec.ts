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
  auditAlert: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
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
            auditAlert: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              updateMany: jest.fn(),
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(AuditService);
    prisma = module.get<MockPrismaService>(PrismaService);
  });

  it('creates an active continuity alert with the compared values', async () => {
    prisma.auditAlert.findUnique.mockResolvedValue(null);

    await service.createEntityContinuityAlert(alertInput);

    expect(prisma.auditAlert.create).toHaveBeenCalledTimes(1);
  });

  it('does not reopen an alert dismissed by the author', async () => {
    prisma.auditAlert.findUnique.mockResolvedValue({
      id: 'alert-1',
      status: AuditStatus.DISMISSED,
    });

    await service.createEntityContinuityAlert(alertInput);

    expect(prisma.auditAlert.update).toHaveBeenCalledTimes(1);
  });

  it('marks unmatched active alerts from an analyzed chunk as obsolete', async () => {
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

    await service.obsoleteContinuityAlertsForChunk({
      sceneId: 'scene-1',
      sourceChunkId: 'chunk-1',
      activeFingerprints: new Set(),
    });

    expect(prisma.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['alert-stale'] } },
      data: { status: AuditStatus.OBSOLETE },
    });
  });

  it('resolves an authorized alert without changing its conflict data', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    prisma.auditAlert.findFirst.mockResolvedValue({ id: 'alert-1' });
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
});
