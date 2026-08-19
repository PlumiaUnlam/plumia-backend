import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  EntityType,
  ProposalStatus,
  Prisma,
  type Entity,
} from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { EntityProposalService } from '../../../src/knowledge/services/entity-proposal.service';

interface MockTx {
  entityProposal: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  entity: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

interface MockPrismaService {
  entityProposal: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('EntityProposalService', () => {
  let service: EntityProposalService;
  let prisma: MockPrismaService;

  const now = new Date('2026-07-18T12:00:00.000Z');
  const confidence = new Prisma.Decimal('0.91');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityProposalService,
        {
          provide: PrismaService,
          useValue: {
            entityProposal: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(EntityProposalService);
    prisma = module.get<MockPrismaService>(PrismaService);
  });

  it('lists pending proposals mapped as response DTOs', async () => {
    prisma.entityProposal.findMany.mockResolvedValue([
      {
        id: 'proposal-1',
        projectId: 'project-1',
        sceneId: 'scene-1',
        entityId: null,
        status: ProposalStatus.PENDING,
        confidenceScore: confidence,
        resolutionReason: null,
        reviewedById: null,
        reviewedAt: null,
        createdAt: now,
        proposedData: {
          canonicalName: 'Elena',
          aliases: ['Eli'],
          type: EntityType.CHARACTER,
          description: 'Protagonist',
          attributes: {},
          imageUrl: null,
        },
        entity: null,
        scene: {
          title: 'Opening',
          chapter: {
            title: 'Chapter 1',
          },
        },
      },
    ]);

    const result = await service.listPendingByProject('user-1', 'project-1');

    expect(prisma.entityProposal.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        status: ProposalStatus.PENDING,
        project: {
          userId: 'user-1',
          deletedAt: null,
        },
      },
      select: {
        id: true,
        projectId: true,
        sceneId: true,
        entityId: true,
        status: true,
        confidenceScore: true,
        resolutionReason: true,
        reviewedById: true,
        reviewedAt: true,
        createdAt: true,
        proposedData: true,
        entity: {
          select: {
            id: true,
            canonicalName: true,
            aliases: true,
            type: true,
            description: true,
            attributes: true,
          },
        },
        scene: {
          select: {
            title: true,
            chapter: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: [{ confidenceScore: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toEqual([
      {
        id: 'proposal-1',
        projectId: 'project-1',
        sceneId: 'scene-1',
        sceneTitle: 'Opening',
        chapterTitle: 'Chapter 1',
        entityId: null,
        status: ProposalStatus.PENDING,
        confidenceScore: 0.91,
        resolutionReason: null,
        reviewedById: null,
        reviewedAt: null,
        createdAt: now,
        targetEntity: null,
        proposedData: {
          canonicalName: 'Elena',
          aliases: ['Eli'],
          type: EntityType.CHARACTER,
          description: 'Protagonist',
          attributes: {},
          imageUrl: null,
        },
      },
    ]);
  });

  it('accepts an update proposal by enriching an existing linked entity', async () => {
    const existingEntity = buildEntity({
      id: 'entity-1',
      canonicalName: 'Elena',
      type: EntityType.CHARACTER,
      confidenceScore: confidence,
      aliases: ['El'],
      description: 'Known mage',
      attributes: { age: 20 },
    });
    const updatedEntity = buildEntity({
      id: 'entity-1',
      canonicalName: 'Elena',
      type: EntityType.CHARACTER,
      confidenceScore: confidence,
      aliases: ['El', 'Eli'],
      description: 'Known mage\n\nShe now bears a silver mark.',
      attributes: { age: 20, rank: 'captain' },
    });
    const tx = createTx({
      proposal: {
        id: 'proposal-1',
        projectId: 'project-1',
        entityId: 'entity-1',
        proposedData: {
          canonicalName: 'Elena',
          aliases: ['Eli'],
          type: EntityType.CHARACTER,
          description: 'She now bears a silver mark.',
          attributes: { rank: 'captain' },
          proposalKind: 'ENTITY_UPDATE',
        },
      },
      entity: existingEntity,
      updatedEntity,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<Entity | null>) =>
        callback(tx),
    );

    const result = await service.acceptProposal('user-1', 'proposal-1');

    expect(tx.entity.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'entity-1',
        project: {
          userId: 'user-1',
          deletedAt: null,
        },
        deletedAt: null,
      },
    });
    expect(tx.entity.create).not.toHaveBeenCalled();
    expect(tx.entity.update).toHaveBeenCalledWith({
      where: { id: 'entity-1' },
      data: {
        canonicalName: 'Elena',
        type: EntityType.CHARACTER,
        aliases: ['El', 'Eli'],
        description: 'Known mage\n\nShe now bears a silver mark.',
        attributes: { age: 20, rank: 'captain' },
      },
    });
    expect(tx.entityProposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal-1' },
      data: {
        entityId: 'entity-1',
        status: ProposalStatus.APPROVED,
        reviewedById: 'user-1',
        reviewedAt: expect.any(Date) as unknown,
        resolutionReason: 'accepted_by_author',
      },
    });
    expect(result).toMatchObject({
      id: 'entity-1',
      projectId: 'project-1',
      canonicalName: 'Elena',
      type: EntityType.CHARACTER,
      isActive: true,
    });
  });

  it('keeps the complete edited description when it includes current and new text', async () => {
    const existingEntity = buildEntity({
      id: 'entity-1',
      canonicalName: 'Elena',
      type: EntityType.CHARACTER,
      confidenceScore: confidence,
      description: 'Known mage',
    });
    const updatedEntity = buildEntity({
      id: 'entity-1',
      canonicalName: 'Elena',
      type: EntityType.CHARACTER,
      confidenceScore: confidence,
      description:
        'Known mage\n\nShe now bears a silver mark.\n\nShe commands the guard.',
    });
    const tx = createTx({
      proposal: {
        id: 'proposal-edited',
        projectId: 'project-1',
        entityId: 'entity-1',
        proposedData: {
          canonicalName: 'Elena',
          aliases: [],
          type: EntityType.CHARACTER,
          description: 'She now bears a silver mark.',
          attributes: {},
        },
      },
      entity: existingEntity,
      updatedEntity,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<Entity | null>) =>
        callback(tx),
    );

    await service.acceptProposal('user-1', 'proposal-edited', {
      description:
        'Known mage\n\nShe now bears a silver mark.\n\nShe commands the guard.',
    });

    expect(tx.entity.update).toHaveBeenCalledWith({
      where: { id: 'entity-1' },
      data: {
        canonicalName: 'Elena',
        type: EntityType.CHARACTER,
        aliases: [],
        description:
          'Known mage\n\nShe now bears a silver mark.\n\nShe commands the guard.',
        attributes: {},
      },
    });
  });

  it('accepts a proposal by creating a new entity when no linked one exists', async () => {
    const createdEntity = buildEntity({
      id: 'entity-2',
      canonicalName: 'Sanctuary',
      type: EntityType.LOCATION,
      confidenceScore: confidence,
    });
    const tx = createTx({
      proposal: {
        id: 'proposal-2',
        projectId: 'project-1',
        entityId: null,
        proposedData: {
          canonicalName: 'Sanctuary',
          aliases: ['The Haven'],
          type: EntityType.LOCATION,
          description: 'Main location',
          attributes: { climate: 'cold' },
          imageUrl: 'https://example.com/location.png',
        },
      },
      entity: null,
      createdEntity,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<Entity | null>) =>
        callback(tx),
    );

    const result = await service.acceptProposal('user-1', 'proposal-2');

    expect(tx.entity.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        canonicalName: 'Sanctuary',
        type: EntityType.LOCATION,
        description: 'Main location',
        aliases: ['The Haven'],
        attributes: { climate: 'cold' },
        imageUrl: 'https://example.com/location.png',
        source: 'ai_proposed',
        confidenceScore: confidence,
      },
    });
    expect(result).toMatchObject({
      id: 'entity-2',
      canonicalName: 'Sanctuary',
      type: EntityType.LOCATION,
    });
  });

  it('throws not found when accepting a missing proposal', async () => {
    const tx = createTx({
      proposal: null,
      entity: null,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: MockTx) => Promise<Entity | null>) =>
        callback(tx),
    );

    await expect(service.acceptProposal('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a pending proposal', async () => {
    prisma.entityProposal.updateMany.mockResolvedValue({ count: 1 });

    await service.rejectProposal('user-1', 'proposal-3');

    expect(prisma.entityProposal.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'proposal-3',
        status: ProposalStatus.PENDING,
        project: {
          userId: 'user-1',
          deletedAt: null,
        },
      },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedById: 'user-1',
        reviewedAt: expect.any(Date) as unknown,
        resolutionReason: 'rejected_by_author',
      },
    });
  });
});

function createTx(input: {
  proposal: {
    id: string;
    projectId: string;
    entityId: string | null;
    proposedData: Record<string, unknown>;
  } | null;
  entity: Entity | null;
  createdEntity?: Entity;
  updatedEntity?: Entity;
}): MockTx {
  return {
    entityProposal: {
      findFirst: jest.fn().mockResolvedValue(
        input.proposal
          ? {
              ...input.proposal,
              status: ProposalStatus.PENDING,
              confidenceScore: new Prisma.Decimal('0.91'),
            }
          : null,
      ),
      update: jest.fn(),
    },
    entity: {
      findFirst: jest.fn().mockResolvedValue(input.entity),
      create: jest.fn().mockResolvedValue(input.createdEntity ?? null),
      update: jest
        .fn()
        .mockResolvedValue(
          input.updatedEntity ?? input.entity ?? input.createdEntity ?? null,
        ),
    },
  };
}

function buildEntity(input: {
  id: string;
  canonicalName: string;
  type: EntityType;
  confidenceScore: Prisma.Decimal;
  aliases?: string[];
  description?: string | null;
  attributes?: Record<string, unknown>;
}): Entity {
  return {
    id: input.id,
    projectId: 'project-1',
    canonicalName: input.canonicalName,
    aliases: input.aliases ?? [],
    type: input.type,
    description: input.description ?? null,
    attributes: (input.attributes ?? {}) as Prisma.JsonObject,
    imageUrl: null,
    source: 'ai_proposed',
    confidenceScore: input.confidenceScore,
    userLockedFields: [],
    isActive: true,
    createdAt: nowValue(),
    updatedAt: nowValue(),
    deletedAt: null,
  };
}

function nowValue(): Date {
  return new Date('2026-07-18T12:00:00.000Z');
}
