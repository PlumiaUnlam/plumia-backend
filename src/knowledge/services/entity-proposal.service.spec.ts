import { BadRequestException } from '@nestjs/common';
import { ProposalStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { EntityProposalService } from './entity-proposal.service';

describe('EntityProposalService', () => {
  it('normalizes legacy payloads before creating an entity', async () => {
    const proposal = {
      id: 'proposal-id',
      projectId: 'project-id',
      entityId: null,
      status: ProposalStatus.PENDING,
      confidenceScore: 0.9,
      proposedData: {
        canonicalName: '  Luna  ',
        type: 'character',
        aliases: [' Luna ', 'Moon', 42],
        description: { invalid: true },
        attributes: null,
        imageUrl: 42,
      },
    };
    const createdEntity = {
      id: 'entity-id',
      projectId: proposal.projectId,
      canonicalName: 'Luna',
      aliases: ['Luna', 'Moon'],
      type: 'CHARACTER',
      description: null,
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.9,
      source: 'ai_proposed',
      userLockedFields: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const tx = {
      entityProposal: {
        findFirst: jest.fn().mockResolvedValue(proposal),
        update: jest.fn().mockResolvedValue(undefined),
      },
      entity: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdEntity),
      },
    };
    const transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new EntityProposalService(prisma);

    await service.acceptProposal('user-id', proposal.id);

    const createCalls = tx.entity.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createData = createCalls[0]?.[0]?.data;
    expect(createData).toBeDefined();
    expect(createData).toMatchObject({
      canonicalName: 'Luna',
      type: 'CHARACTER',
      aliases: ['Luna', 'Moon'],
      attributes: {},
      source: 'ai_proposed',
    });
    expect(createData).not.toHaveProperty('description');
    expect(createData).not.toHaveProperty('imageUrl');
  });

  it('rejects a new proposal without a canonical name before Prisma', async () => {
    const tx = {
      entityProposal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proposal-id',
          projectId: 'project-id',
          entityId: null,
          status: ProposalStatus.PENDING,
          confidenceScore: 0.9,
          proposedData: { type: 'CHARACTER' },
        }),
      },
      entity: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new EntityProposalService(prisma);

    await expect(
      service.acceptProposal('user-id', 'proposal-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.entity.create).not.toHaveBeenCalled();
  });

  it('uses an override to complete a legacy proposal before validation', async () => {
    const proposal = {
      id: 'proposal-id',
      projectId: 'project-id',
      entityId: null,
      status: ProposalStatus.PENDING,
      confidenceScore: 0.9,
      proposedData: { type: 'character' },
    };
    const createdEntity = {
      id: 'entity-id',
      projectId: proposal.projectId,
      canonicalName: 'Luna',
      aliases: [],
      type: 'CHARACTER',
      description: null,
      attributes: {},
      imageUrl: null,
      confidenceScore: 0.9,
      source: 'ai_proposed',
      userLockedFields: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const tx = {
      entityProposal: {
        findFirst: jest.fn().mockResolvedValue(proposal),
        update: jest.fn().mockResolvedValue(undefined),
      },
      entity: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdEntity),
      },
    };
    const transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new EntityProposalService(prisma);

    await service.acceptProposal('user-id', proposal.id, {
      canonicalName: 'Luna',
    });

    const createCalls = tx.entity.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(createCalls[0]?.[0]?.data).toMatchObject({
      canonicalName: 'Luna',
      type: 'CHARACTER',
    });
  });

  it('keeps the existing image when an update has no image suggestion', async () => {
    const proposal = {
      id: 'proposal-id',
      projectId: 'project-id',
      entityId: 'entity-id',
      status: ProposalStatus.PENDING,
      confidenceScore: 0.9,
      proposedData: {
        canonicalName: 'Luna',
        type: 'CHARACTER',
        aliases: ['La guardiana'],
        attributes: {},
        imageUrl: null,
      },
    };
    const existingEntity = {
      id: proposal.entityId,
      projectId: proposal.projectId,
      canonicalName: 'Luna',
      aliases: [],
      type: 'CHARACTER',
      description: 'Guardiana de la ciudad.',
      attributes: {},
      imageUrl: 'https://example.com/luna.png',
      confidenceScore: 1,
      source: 'author_manual',
      userLockedFields: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const tx = {
      entityProposal: {
        findFirst: jest.fn().mockResolvedValue(proposal),
        update: jest.fn().mockResolvedValue(undefined),
      },
      entity: {
        findFirst: jest.fn().mockResolvedValue(existingEntity),
        update: jest.fn().mockResolvedValue(existingEntity),
      },
    };
    const transaction = jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new EntityProposalService(prisma);

    await service.acceptProposal('user-id', proposal.id);

    const updateCalls = tx.entity.update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(updateCalls[0]?.[0]?.data).not.toHaveProperty('imageUrl');
  });
});
