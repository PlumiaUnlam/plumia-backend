import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, ProposalStatus, RelationType } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RelationshipProposalService } from '../../../src/knowledge/services/relationship-proposal.service';

interface MockPrisma {
  relationshipProposal: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
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
});
