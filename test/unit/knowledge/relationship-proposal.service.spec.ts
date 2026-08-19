import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, ProposalStatus, RelationType } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RelationshipProposalService } from '../../../src/knowledge/services/relationship-proposal.service';
import { RelationType as DomainRelationType } from '../../../src/knowledge/domain/relation-type';

interface MockPrisma {
  relationshipProposal: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface MockTx {
  relationshipProposal: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  entity: {
    count: jest.Mock;
  };
  relationship: {
    create: jest.Mock;
    update: jest.Mock;
  };
}

describe('RelationshipProposalService', () => {
  let service: RelationshipProposalService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelationshipProposalService,
        {
          provide: PrismaService,
          useValue: {
            relationshipProposal: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(RelationshipProposalService);
    prisma = module.get<MockPrisma>(PrismaService);
  });

  it('lists a relationship proposal and marks it ready when both entities exist', async () => {
    prisma.relationshipProposal.findMany.mockResolvedValue([
      {
        id: 'proposal-1',
        projectId: 'project-1',
        sceneId: 'scene-1',
        relationshipId: null,
        relationType: RelationType.ALLY,
        description: 'They protect each other.',
        intensity: new Prisma.Decimal('0.8'),
        evidence: ['They fought side by side.'],
        status: ProposalStatus.PENDING,
        createdAt: new Date('2026-08-08T12:00:00.000Z'),
        sourceEntity: { id: 'entity-1', canonicalName: 'Elena' },
        targetEntity: { id: 'entity-2', canonicalName: 'Mara' },
        sourceEntityProposal: null,
        targetEntityProposal: null,
      },
    ]);

    const result = await service.listPendingByProject('user-1', 'project-1');

    expect(result[0]).toMatchObject({
      id: 'proposal-1',
      relationType: RelationType.ALLY,
      canAccept: true,
      source: { id: 'entity-1', canonicalName: 'Elena', isPending: false },
      target: { id: 'entity-2', canonicalName: 'Mara', isPending: false },
    });
  });

  it('does not accept a proposal while one endpoint entity is pending', async () => {
    const tx = {
      relationshipProposal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          projectId: 'project-1',
          sceneId: 'scene-1',
          relationshipId: null,
          sourceEntityId: 'entity-1',
          targetEntityId: null,
          sourceEntityProposal: null,
          targetEntityProposal: { entityId: null },
          relationType: RelationType.KNOWS,
          description: null,
          intensity: new Prisma.Decimal('0.5'),
        }),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    await expect(
      service.acceptProposal('user-1', 'proposal-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a new relationship proposal', async () => {
    const relationship = buildRelationship({
      id: 'relationship-1',
      relationType: RelationType.ALLY,
      confidenceScore: '0.8',
      description: 'They protect each other.',
    });
    const tx = createTx({
      proposal: {
        id: 'proposal-2',
        projectId: 'project-1',
        sceneId: 'scene-1',
        relationshipId: null,
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        sourceEntityProposal: null,
        targetEntityProposal: null,
        relationType: RelationType.ALLY,
        description: 'They protect each other.',
        intensity: new Prisma.Decimal('0.8'),
      },
      relationship,
      entityCount: 2,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<unknown>) =>
        callback(tx),
    );

    const result = await service.acceptProposal('user-1', 'proposal-2');

    expect(tx.relationship.create).toHaveBeenCalled();
    expect(tx.relationship.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'relationship-1',
      relationType: RelationType.ALLY,
      intensity: 4,
      description: 'They protect each other.',
    });
  });

  it('updates an accepted relationship with edited proposal data', async () => {
    const relationship = buildRelationship({
      id: 'relationship-2',
      relationType: RelationType.KNOWS,
      confidenceScore: '0.4',
      description: 'They have met before.',
    });
    const tx = createTx({
      proposal: {
        id: 'proposal-3',
        projectId: 'project-1',
        sceneId: 'scene-2',
        relationshipId: 'relationship-2',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        sourceEntityProposal: null,
        targetEntityProposal: null,
        relationType: RelationType.KNOWS,
        description: 'They now work together.',
        intensity: new Prisma.Decimal('0.6'),
      },
      relationship,
      entityCount: 2,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<unknown>) =>
        callback(tx),
    );

    await service.acceptProposal('user-1', 'proposal-3', {
      relationType: DomainRelationType.ALLY,
      intensity: 5,
      description: 'They have met before.\n\nThey now work together by choice.',
    });

    expect(tx.relationship.update).toHaveBeenCalledWith({
      where: { id: 'relationship-2' },
      data: {
        description:
          'They have met before.\n\nThey now work together by choice.',
        relationType: RelationType.ALLY,
        confidenceScore: new Prisma.Decimal(1),
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
      },
    });
    expect(tx.relationship.create).not.toHaveBeenCalled();
  });

  it('rejects self relationships and missing proposals', async () => {
    const selfTx = createTx({
      proposal: {
        id: 'proposal-self',
        projectId: 'project-1',
        sceneId: 'scene-1',
        relationshipId: null,
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-1',
        sourceEntityProposal: null,
        targetEntityProposal: null,
        relationType: RelationType.KNOWS,
        description: null,
        intensity: new Prisma.Decimal('0.5'),
      },
      relationship: null,
      entityCount: 2,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<unknown>) =>
        callback(selfTx),
    );

    await expect(
      service.acceptProposal('user-1', 'proposal-self'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const missingTx = createTx({
      proposal: null,
      relationship: null,
      entityCount: 0,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<unknown>) =>
        callback(missingTx),
    );

    await expect(service.acceptProposal('user-1', 'missing')).rejects.toThrow(
      'Relationship proposal not found',
    );
  });

  it('rejects a pending relationship proposal', async () => {
    prisma.relationshipProposal.updateMany.mockResolvedValue({ count: 1 });

    await service.rejectProposal('user-1', 'proposal-1');

    expect(prisma.relationshipProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal-1',
          status: ProposalStatus.PENDING,
        }) as unknown,
        data: expect.objectContaining({
          status: ProposalStatus.REJECTED,
        }) as unknown,
      }),
    );
  });

  it('throws when rejecting a missing relationship proposal', async () => {
    prisma.relationshipProposal.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.rejectProposal('user-1', 'missing')).rejects.toThrow(
      'Relationship proposal not found',
    );
  });
});

function createTx(input: {
  proposal: Record<string, unknown> | null;
  relationship: Record<string, unknown> | null;
  entityCount: number;
}): MockTx {
  const relationshipCreate = jest.fn().mockResolvedValue(input.relationship);
  const relationshipUpdate = jest.fn().mockResolvedValue(input.relationship);

  return {
    relationshipProposal: {
      findFirst: jest.fn().mockResolvedValue(input.proposal),
      update: jest.fn(),
    },
    entity: {
      count: jest.fn().mockResolvedValue(input.entityCount),
    },
    relationship: {
      create: relationshipCreate,
      update: relationshipUpdate,
    },
  };
}

function buildRelationship(input: {
  id: string;
  relationType: RelationType;
  confidenceScore: string;
  description: string;
}): Record<string, unknown> {
  const timestamp = new Date('2026-08-08T12:00:00.000Z');
  return {
    id: input.id,
    projectId: 'project-1',
    sourceEntityId: 'entity-1',
    targetEntityId: 'entity-2',
    relationType: input.relationType,
    confidenceScore: new Prisma.Decimal(input.confidenceScore),
    description: input.description,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
