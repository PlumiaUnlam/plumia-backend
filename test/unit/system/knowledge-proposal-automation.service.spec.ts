import { Prisma } from '@prisma/client';
import { KnowledgeProposalAutomationService } from '../../../src/system/knowledge-proposal-automation.service';

describe('KnowledgeProposalAutomationService', () => {
  const createService = () => {
    const prisma = {
      scene: {
        findFirst: jest.fn().mockResolvedValue({
          chapter: {
            book: { projectId: 'project-1', project: { userId: 'user-1' } },
          },
        }),
      },
      projectKnowledgeReviewSettings: { findUnique: jest.fn() },
      entityStateProposal: { findMany: jest.fn().mockResolvedValue([]) },
      relationshipProposal: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const temporalStates = { acceptProposalSequence: jest.fn() };
    const relationshipProposals = { acceptProposal: jest.fn() };
    return {
      service: new KnowledgeProposalAutomationService(
        prisma as never,
        temporalStates as never,
        relationshipProposals as never,
      ),
      prisma,
      temporalStates,
      relationshipProposals,
    };
  };

  it('does not approve proposals in manual mode', async () => {
    const { service, prisma, temporalStates, relationshipProposals } =
      createService();
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateReviewMode: 'MANUAL',
      stateConfidenceThreshold: new Prisma.Decimal('0.90'),
      relationshipReviewMode: 'MANUAL',
      relationshipConfidenceThreshold: new Prisma.Decimal('0.90'),
    });

    await service.reviewScene('scene-1');

    expect(prisma.entityStateProposal.findMany).not.toHaveBeenCalled();
    expect(prisma.relationshipProposal.findMany).not.toHaveBeenCalled();
    expect(temporalStates.acceptProposalSequence).not.toHaveBeenCalled();
    expect(relationshipProposals.acceptProposal).not.toHaveBeenCalled();
  });

  it('auto-approves only a confident transition with fresh evidence', async () => {
    const { service, prisma, temporalStates } = createService();
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateReviewMode: 'AUTO_THRESHOLD',
      stateConfidenceThreshold: new Prisma.Decimal('0.90'),
      relationshipReviewMode: 'MANUAL',
      relationshipConfidenceThreshold: new Prisma.Decimal('0.90'),
    });
    prisma.entityStateProposal.findMany.mockResolvedValue([
      {
        id: 'state-proposal-1',
        entityId: 'entity-1',
        sceneId: 'scene-1',
        attributeKey: 'location',
        toValue: 'Puerto',
        sequenceKind: 'TRANSITION',
        conflictsWithLocked: false,
        confidenceScore: new Prisma.Decimal('0.96'),
        sourceChunkHash: 'hash-1',
        sourceChunk: { contentHash: 'hash-1', isDirty: false },
        evidence: ['Llegó al puerto.'],
        narrativeOrder: 1000,
        createdAt: new Date(),
      },
    ]);

    await service.reviewScene('scene-1');

    expect(temporalStates.acceptProposalSequence).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      { acceptedProposalIds: ['state-proposal-1'], rejectedProposalIds: [] },
    );
  });

  it('keeps uncertain and stale state proposals for manual review', async () => {
    const { service, prisma, temporalStates } = createService();
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateReviewMode: 'AUTO_THRESHOLD',
      stateConfidenceThreshold: new Prisma.Decimal('0.90'),
      relationshipReviewMode: 'MANUAL',
      relationshipConfidenceThreshold: new Prisma.Decimal('0.90'),
    });
    prisma.entityStateProposal.findMany.mockResolvedValue([
      {
        id: 'uncertain',
        entityId: 'entity-1',
        sceneId: 'scene-1',
        attributeKey: 'status',
        toValue: 'dead',
        sequenceKind: 'UNCERTAIN',
        conflictsWithLocked: false,
        confidenceScore: new Prisma.Decimal('0.99'),
        sourceChunkHash: 'hash-1',
        sourceChunk: { contentHash: 'hash-1', isDirty: false },
        evidence: ['Quizás haya muerto.'],
        narrativeOrder: 1000,
        createdAt: new Date(),
      },
      {
        id: 'stale',
        entityId: 'entity-2',
        sceneId: 'scene-1',
        attributeKey: 'location',
        toValue: 'Puerto',
        sequenceKind: 'TRANSITION',
        conflictsWithLocked: false,
        confidenceScore: new Prisma.Decimal('0.99'),
        sourceChunkHash: 'old-hash',
        sourceChunk: { contentHash: 'new-hash', isDirty: false },
        evidence: ['Llegó al puerto.'],
        narrativeOrder: 1000,
        createdAt: new Date(),
      },
    ]);

    await service.reviewScene('scene-1');

    expect(temporalStates.acceptProposalSequence).not.toHaveBeenCalled();
  });

  it('requires confirmed endpoints and unique fresh evidence for auto-approving relations', async () => {
    const { service, prisma, relationshipProposals } = createService();
    prisma.projectKnowledgeReviewSettings.findUnique.mockResolvedValue({
      stateReviewMode: 'MANUAL',
      stateConfidenceThreshold: new Prisma.Decimal('0.90'),
      relationshipReviewMode: 'AUTO_THRESHOLD',
      relationshipConfidenceThreshold: new Prisma.Decimal('0.90'),
    });
    prisma.relationshipProposal.findMany.mockResolvedValue([
      {
        id: 'relation-1',
        projectId: 'project-1',
        sceneId: 'scene-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        sourceEntityProposalId: null,
        targetEntityProposalId: null,
        relationType: 'ALLY',
        confidenceScore: new Prisma.Decimal('0.95'),
        sourceChunkHash: 'hash-1',
        sourceChunk: { contentHash: 'hash-1', isDirty: false },
        evidence: ['Elena y Mara se juraron lealtad.'],
      },
      {
        id: 'relation-pending-endpoint',
        projectId: 'project-1',
        sceneId: 'scene-1',
        sourceEntityId: 'entity-1',
        targetEntityId: null,
        sourceEntityProposalId: null,
        targetEntityProposalId: 'entity-proposal-1',
        relationType: 'ALLY',
        confidenceScore: new Prisma.Decimal('0.99'),
        sourceChunkHash: 'hash-1',
        sourceChunk: { contentHash: 'hash-1', isDirty: false },
        evidence: ['Elena y una desconocida se aliaron.'],
      },
    ]);

    await service.reviewScene('scene-1');

    expect(prisma.relationshipProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceEntityProposalId: null,
          targetEntityProposalId: null,
        }) as unknown,
      }) as unknown,
    );
    expect(relationshipProposals.acceptProposal).toHaveBeenCalledTimes(1);
    expect(relationshipProposals.acceptProposal).toHaveBeenCalledWith(
      'user-1',
      'relation-1',
    );
  });
});
